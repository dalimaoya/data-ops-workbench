"""Webhook Integration — Webhook 集成"""

import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Text, DateTime, SmallInteger
from pydantic import BaseModel

from app.database import get_db, engine, Base
from app.models import UserAccount
from app.utils.auth import get_current_user, require_role

_BJT = timezone(timedelta(hours=8))


def _now_bjt():
    return datetime.now(_BJT)


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoint"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False)
    url = Column(String(500), nullable=False)
    secret = Column(String(255), nullable=True)
    events = Column(Text, nullable=True)  # JSON array: ["writeback", "export", "import", "approval", "user_change"]
    enabled = Column(SmallInteger, nullable=False, default=1)
    last_triggered_at = Column(DateTime, nullable=True)
    last_status = Column(String(32), nullable=True)
    created_by = Column(String(64), nullable=False, default="system")
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


class WebhookLog(Base):
    __tablename__ = "webhook_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    endpoint_id = Column(Integer, nullable=False)
    event_type = Column(String(64), nullable=False)
    payload = Column(Text, nullable=True)
    response_status = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    success = Column(SmallInteger, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/api/webhooks", tags=["webhook"])


class WebhookCreate(BaseModel):
    name: str
    url: str
    secret: Optional[str] = None
    events: List[str] = []
    enabled: bool = True


class WebhookUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    secret: Optional[str] = None
    events: Optional[List[str]] = None
    enabled: Optional[bool] = None


@router.get("")
def list_webhooks(db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    endpoints = db.query(WebhookEndpoint).order_by(WebhookEndpoint.id).all()
    return {
        "items": [
            {
                "id": e.id,
                "name": e.name,
                "url": e.url,
                "events": json.loads(e.events) if e.events else [],
                "enabled": bool(e.enabled),
                "last_triggered_at": e.last_triggered_at.isoformat() if e.last_triggered_at else None,
                "last_status": e.last_status,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in endpoints
        ]
    }


@router.post("")
def create_webhook(body: WebhookCreate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ep = WebhookEndpoint(
        name=body.name,
        url=body.url,
        secret=body.secret,
        events=json.dumps(body.events),
        enabled=1 if body.enabled else 0,
        created_by=user.username,
    )
    db.add(ep)
    db.commit()
    return {"success": True, "id": ep.id}


@router.get("/{webhook_id}")
def get_webhook(webhook_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ep = db.query(WebhookEndpoint).filter(WebhookEndpoint.id == webhook_id).first()
    if not ep:
        raise HTTPException(404, "Webhook 不存在")
    return {
        "id": ep.id,
        "name": ep.name,
        "url": ep.url,
        "secret": ep.secret or "",
        "events": json.loads(ep.events) if ep.events else [],
        "enabled": bool(ep.enabled),
    }


@router.put("/{webhook_id}")
def update_webhook(webhook_id: int, body: WebhookUpdate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ep = db.query(WebhookEndpoint).filter(WebhookEndpoint.id == webhook_id).first()
    if not ep:
        raise HTTPException(404, "Webhook 不存在")
    if body.name is not None:
        ep.name = body.name
    if body.url is not None:
        ep.url = body.url
    if body.secret is not None:
        ep.secret = body.secret
    if body.events is not None:
        ep.events = json.dumps(body.events)
    if body.enabled is not None:
        ep.enabled = 1 if body.enabled else 0
    db.commit()
    return {"success": True}


@router.delete("/{webhook_id}")
def delete_webhook(webhook_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ep = db.query(WebhookEndpoint).filter(WebhookEndpoint.id == webhook_id).first()
    if not ep:
        raise HTTPException(404, "Webhook 不存在")
    db.delete(ep)
    db.commit()
    return {"success": True}


def fire_webhook(event_type: str, detail: dict):
    """Fire webhook for the given event type. Call from other modules."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        endpoints = db.query(WebhookEndpoint).filter(WebhookEndpoint.enabled == 1).all()
        for ep in endpoints:
            events = json.loads(ep.events) if ep.events else []
            if event_type not in events and "*" not in events:
                continue
            payload = {
                "event": event_type,
                "timestamp": datetime.now(_BJT).isoformat(),
                "detail": detail,
            }
            payload_str = json.dumps(payload, ensure_ascii=False, default=str)
            try:
                headers = {"Content-Type": "application/json"}
                if ep.secret:
                    import hashlib
                    sig = hashlib.sha256(f"{payload_str}{ep.secret}".encode()).hexdigest()
                    headers["X-Webhook-Signature"] = sig
                resp = httpx.post(ep.url, content=payload_str.encode(), headers=headers, timeout=10)
                log_entry = WebhookLog(
                    endpoint_id=ep.id, event_type=event_type,
                    payload=payload_str[:2000],
                    response_status=resp.status_code,
                    response_body=resp.text[:500],
                    success=1 if resp.status_code < 400 else 0,
                )
                ep.last_triggered_at = _now_bjt()
                ep.last_status = "success" if resp.status_code < 400 else "failed"
            except Exception as e:
                log_entry = WebhookLog(
                    endpoint_id=ep.id, event_type=event_type,
                    payload=payload_str[:2000],
                    response_status=0, response_body=str(e)[:500],
                    success=0,
                )
                ep.last_triggered_at = _now_bjt()
                ep.last_status = "error"
            db.add(log_entry)
        db.commit()
    finally:
        db.close()


@router.post("/{webhook_id}/test")
def test_webhook(webhook_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ep = db.query(WebhookEndpoint).filter(WebhookEndpoint.id == webhook_id).first()
    if not ep:
        raise HTTPException(404, "Webhook 不存在")
    payload = {
        "event": "test",
        "timestamp": datetime.now(_BJT).isoformat(),
        "detail": {"message": "This is a test webhook from Data Ops Workbench"},
    }
    try:
        headers = {"Content-Type": "application/json"}
        payload_str = json.dumps(payload, ensure_ascii=False)
        if ep.secret:
            import hashlib
            sig = hashlib.sha256(f"{payload_str}{ep.secret}".encode()).hexdigest()
            headers["X-Webhook-Signature"] = sig
        resp = httpx.post(ep.url, content=payload_str.encode(), headers=headers, timeout=10)
        return {"success": resp.status_code < 400, "status_code": resp.status_code, "response": resp.text[:200]}
    except Exception as e:
        return {"success": False, "error": str(e)}
