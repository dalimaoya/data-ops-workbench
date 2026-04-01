"""Notification Center — 通知推送中心

Unified notification channels: WeChat Bot / DingTalk Bot / Email / Custom Webhook
Event subscriptions and push history.
"""

import json
import hashlib
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
from app.utils.crypto import encrypt_password, decrypt_password

_BJT = timezone(timedelta(hours=8))


def _now_bjt():
    return datetime.now(_BJT)


# ── Models ──────────────────────────────────────────────────────

class NotificationChannel(Base):
    __tablename__ = "notification_channel"
    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_type = Column(String(32), nullable=False)  # wechat_bot / dingtalk_bot / email / webhook
    name = Column(String(128), nullable=False)
    config = Column(Text, nullable=False, default="{}")  # JSON config
    enabled = Column(SmallInteger, nullable=False, default=1)
    created_by = Column(String(64), nullable=False, default="system")
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


class NotificationSubscription(Base):
    __tablename__ = "notification_subscription"
    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(Integer, nullable=False, index=True)
    event_type = Column(String(64), nullable=False)  # writeback / export / import / approval / user_change / health_alert
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


class NotificationLog(Base):
    __tablename__ = "notification_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(Integer, nullable=False, index=True)
    channel_name = Column(String(128), nullable=True)
    channel_type = Column(String(32), nullable=True)
    event_type = Column(String(64), nullable=False)
    payload = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="pending")  # success / failed
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=False, default=_now_bjt)


Base.metadata.create_all(bind=engine)

# Data migration from old tables (idempotent)
_migration_done = False


def _migrate_old_data():
    global _migration_done
    if _migration_done:
        return
    _migration_done = True
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        # Skip if new table already has data
        if db.query(NotificationChannel).count() > 0:
            return

        # Migrate from notify_push_config
        try:
            rows = db.execute(
                "SELECT wechat_work_webhook, dingtalk_webhook, smtp_host, smtp_port, "
                "smtp_username, smtp_password_encrypted, smtp_from_email, smtp_to_emails, "
                "smtp_use_ssl, notify_on_writeback, notify_on_approval, "
                "notify_on_health_error, notify_on_task_fail, updated_by "
                "FROM notify_push_config LIMIT 1"
            ).fetchone() if db.bind.dialect.has_table(db.bind.connect(), "notify_push_config") else None
        except Exception:
            rows = None

        if rows:
            event_flags = {
                "writeback": rows[9], "approval": rows[10],
                "health_alert": rows[11], "task_fail": rows[12],
            }
            events_on = [k for k, v in event_flags.items() if v]

            if rows[0]:  # wechat
                ch = NotificationChannel(
                    channel_type="wechat_bot", name="企微机器人（迁移）",
                    config=json.dumps({"webhook_url": rows[0]}),
                    enabled=1, created_by=rows[13] or "migration",
                )
                db.add(ch)
                db.flush()
                for evt in events_on:
                    db.add(NotificationSubscription(channel_id=ch.id, event_type=evt))

            if rows[1]:  # dingtalk
                ch = NotificationChannel(
                    channel_type="dingtalk_bot", name="钉钉机器人（迁移）",
                    config=json.dumps({"webhook_url": rows[1]}),
                    enabled=1, created_by=rows[13] or "migration",
                )
                db.add(ch)
                db.flush()
                for evt in events_on:
                    db.add(NotificationSubscription(channel_id=ch.id, event_type=evt))

            if rows[2]:  # email
                ch = NotificationChannel(
                    channel_type="email", name="邮件通知（迁移）",
                    config=json.dumps({
                        "smtp_host": rows[2], "smtp_port": rows[3] or 465,
                        "smtp_username": rows[4] or "",
                        "smtp_password_encrypted": rows[5] or "",
                        "smtp_from_email": rows[6] or "",
                        "smtp_to_emails": rows[7] or "",
                        "smtp_use_ssl": bool(rows[8]),
                    }),
                    enabled=1, created_by=rows[13] or "migration",
                )
                db.add(ch)
                db.flush()
                for evt in events_on:
                    db.add(NotificationSubscription(channel_id=ch.id, event_type=evt))

        # Migrate from webhook_endpoint
        try:
            wh_rows = db.execute(
                "SELECT id, name, url, secret, events, enabled, created_by "
                "FROM webhook_endpoint"
            ).fetchall() if db.bind.dialect.has_table(db.bind.connect(), "webhook_endpoint") else []
        except Exception:
            wh_rows = []

        for wh in wh_rows:
            ch = NotificationChannel(
                channel_type="webhook", name=wh[1] or "Webhook（迁移）",
                config=json.dumps({"url": wh[2], "secret": wh[3] or ""}),
                enabled=wh[5], created_by=wh[6] or "migration",
            )
            db.add(ch)
            db.flush()
            events = json.loads(wh[4]) if wh[4] else []
            for evt in events:
                db.add(NotificationSubscription(channel_id=ch.id, event_type=evt))

        db.commit()
    except Exception as e:
        import logging
        logging.getLogger("plugin").warning("notification migration: %s", e)
        db.rollback()
    finally:
        db.close()


# Run migration on module load
try:
    _migrate_old_data()
except Exception:
    pass


# ── Schemas ─────────────────────────────────────────────────────

EVENT_TYPES = ["writeback", "export", "import", "approval", "user_change", "health_alert"]
CHANNEL_TYPES = ["wechat_bot", "dingtalk_bot", "email", "webhook"]


class ChannelCreate(BaseModel):
    channel_type: str
    name: str
    config: dict = {}
    enabled: bool = True


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None


class SubscriptionUpdate(BaseModel):
    subscriptions: dict  # { channel_id: [event_type, ...] }


class TestChannelRequest(BaseModel):
    message: str = "这是一条测试消息 / This is a test message"


# ── Router ──────────────────────────────────────────────────────

router = APIRouter(prefix="/api/notification-push", tags=["notification-push"])


# ── Channels CRUD ───────────────────────────────────────────────

@router.get("/channels")
def list_channels(db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    channels = db.query(NotificationChannel).order_by(NotificationChannel.id).all()
    return {
        "items": [
            {
                "id": ch.id,
                "channel_type": ch.channel_type,
                "name": ch.name,
                "config": json.loads(ch.config) if ch.config else {},
                "enabled": bool(ch.enabled),
                "created_by": ch.created_by,
                "created_at": ch.created_at.isoformat() if ch.created_at else None,
            }
            for ch in channels
        ]
    }


@router.post("/channels")
def create_channel(body: ChannelCreate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    if body.channel_type not in CHANNEL_TYPES:
        raise HTTPException(400, f"不支持的渠道类型: {body.channel_type}")
    ch = NotificationChannel(
        channel_type=body.channel_type,
        name=body.name,
        config=json.dumps(body.config, ensure_ascii=False),
        enabled=1 if body.enabled else 0,
        created_by=user.username,
    )
    # Encrypt email password if present
    if body.channel_type == "email" and body.config.get("smtp_password"):
        cfg = dict(body.config)
        cfg["smtp_password_encrypted"] = encrypt_password(cfg.pop("smtp_password"))
        ch.config = json.dumps(cfg, ensure_ascii=False)
    db.add(ch)
    db.commit()
    return {"success": True, "id": ch.id}


@router.put("/channels/{channel_id}")
def update_channel(channel_id: int, body: ChannelUpdate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "渠道不存在")
    if body.name is not None:
        ch.name = body.name
    if body.config is not None:
        cfg = dict(body.config)
        # Encrypt email password if updating
        if ch.channel_type == "email" and cfg.get("smtp_password"):
            cfg["smtp_password_encrypted"] = encrypt_password(cfg.pop("smtp_password"))
        ch.config = json.dumps(cfg, ensure_ascii=False)
    if body.enabled is not None:
        ch.enabled = 1 if body.enabled else 0
    db.commit()
    return {"success": True}


@router.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "渠道不存在")
    db.query(NotificationSubscription).filter(NotificationSubscription.channel_id == channel_id).delete()
    db.delete(ch)
    db.commit()
    return {"success": True}


# ── Subscriptions ───────────────────────────────────────────────

@router.get("/subscriptions")
def get_subscriptions(db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    subs = db.query(NotificationSubscription).all()
    # Build matrix: { channel_id: [event_type, ...] }
    matrix = {}
    for s in subs:
        matrix.setdefault(s.channel_id, []).append(s.event_type)
    return {"subscriptions": matrix, "event_types": EVENT_TYPES}


@router.put("/subscriptions")
def update_subscriptions(body: SubscriptionUpdate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    # Clear all existing subscriptions
    db.query(NotificationSubscription).delete()
    for ch_id_str, events in body.subscriptions.items():
        ch_id = int(ch_id_str)
        for evt in events:
            if evt in EVENT_TYPES:
                db.add(NotificationSubscription(channel_id=ch_id, event_type=evt))
    db.commit()
    return {"success": True}


# ── Push Logs ───────────────────────────────────────────────────

@router.get("/logs")
def get_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    logs = db.query(NotificationLog).order_by(NotificationLog.id.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": lg.id,
                "channel_id": lg.channel_id,
                "channel_name": lg.channel_name,
                "channel_type": lg.channel_type,
                "event_type": lg.event_type,
                "status": lg.status,
                "error_message": lg.error_message,
                "sent_at": lg.sent_at.isoformat() if lg.sent_at else None,
            }
            for lg in logs
        ]
    }


# ── Test Channel ────────────────────────────────────────────────

@router.post("/channels/{channel_id}/test")
def test_channel(channel_id: int, body: TestChannelRequest, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ch = db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "渠道不存在")
    cfg = json.loads(ch.config) if ch.config else {}
    result = _dispatch_single(ch.channel_type, cfg, "test", body.message)
    # Log
    db.add(NotificationLog(
        channel_id=ch.id, channel_name=ch.name, channel_type=ch.channel_type,
        event_type="test", payload=body.message[:500],
        status="success" if result["success"] else "failed",
        error_message=result.get("detail") if not result["success"] else None,
    ))
    db.commit()
    return result


# ── Send Helpers ────────────────────────────────────────────────

def _dispatch_single(channel_type: str, config: dict, event_type: str, message: str) -> dict:
    if channel_type == "wechat_bot":
        return _send_wechat(config.get("webhook_url", ""), message)
    elif channel_type == "dingtalk_bot":
        return _send_dingtalk(config.get("webhook_url", ""), message)
    elif channel_type == "email":
        return _send_email(config, f"[数据运维工作台] {event_type}", message)
    elif channel_type == "webhook":
        return _send_webhook(config, event_type, message)
    return {"success": False, "detail": f"Unknown channel type: {channel_type}"}


def _send_wechat(webhook_url: str, message: str) -> dict:
    if not webhook_url:
        return {"success": False, "detail": "Webhook URL not configured"}
    try:
        resp = httpx.post(webhook_url, json={"msgtype": "text", "text": {"content": f"[数据运维工作台] {message}"}}, timeout=10)
        return {"success": resp.status_code == 200, "detail": resp.text[:200]}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def _send_dingtalk(webhook_url: str, message: str) -> dict:
    if not webhook_url:
        return {"success": False, "detail": "Webhook URL not configured"}
    try:
        resp = httpx.post(webhook_url, json={"msgtype": "text", "text": {"content": f"[数据运维工作台] {message}"}}, timeout=10)
        return {"success": resp.status_code == 200, "detail": resp.text[:200]}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def _send_email(config: dict, subject: str, body_text: str) -> dict:
    try:
        pwd = ""
        if config.get("smtp_password_encrypted"):
            pwd = decrypt_password(config["smtp_password_encrypted"])
        elif config.get("smtp_password"):
            pwd = config["smtp_password"]

        msg = MIMEMultipart()
        msg["From"] = config.get("smtp_from_email") or config.get("smtp_username", "")
        to_list = [e.strip() for e in (config.get("smtp_to_emails") or "").split(",") if e.strip()]
        if not to_list:
            return {"success": False, "detail": "No recipients configured"}
        msg["To"] = ", ".join(to_list)
        msg["Subject"] = subject
        msg.attach(MIMEText(body_text, "plain", "utf-8"))

        host = config.get("smtp_host", "")
        port = config.get("smtp_port", 465)
        use_ssl = config.get("smtp_use_ssl", True)

        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
        else:
            server = smtplib.SMTP(host, port or 25, timeout=10)
            server.starttls()
        server.login(config.get("smtp_username", ""), pwd)
        server.sendmail(msg["From"], to_list, msg.as_string())
        server.quit()
        return {"success": True, "detail": f"Sent to {len(to_list)} recipients"}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def _send_webhook(config: dict, event_type: str, message: str) -> dict:
    url = config.get("url", "")
    if not url:
        return {"success": False, "detail": "URL not configured"}
    secret = config.get("secret", "")
    payload = {
        "event": event_type,
        "timestamp": datetime.now(_BJT).isoformat(),
        "detail": {"message": message},
    }
    payload_str = json.dumps(payload, ensure_ascii=False, default=str)
    try:
        headers = {"Content-Type": "application/json"}
        if secret:
            sig = hashlib.sha256(f"{payload_str}{secret}".encode()).hexdigest()
            headers["X-Webhook-Signature"] = sig
        resp = httpx.post(url, content=payload_str.encode(), headers=headers, timeout=10)
        return {"success": resp.status_code < 400, "detail": resp.text[:200]}
    except Exception as e:
        return {"success": False, "detail": str(e)}


# ── Public API for other modules ────────────────────────────────

def send_notification(event_type: str, message: str):
    """Send notification to all subscribed channels for this event type."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        subs = db.query(NotificationSubscription).filter(
            NotificationSubscription.event_type == event_type
        ).all()
        channel_ids = {s.channel_id for s in subs}
        if not channel_ids:
            return

        channels = db.query(NotificationChannel).filter(
            NotificationChannel.id.in_(channel_ids),
            NotificationChannel.enabled == 1,
        ).all()

        for ch in channels:
            cfg = json.loads(ch.config) if ch.config else {}
            result = _dispatch_single(ch.channel_type, cfg, event_type, message)
            db.add(NotificationLog(
                channel_id=ch.id, channel_name=ch.name, channel_type=ch.channel_type,
                event_type=event_type, payload=message[:500],
                status="success" if result["success"] else "failed",
                error_message=result.get("detail") if not result["success"] else None,
            ))
        db.commit()
    except Exception:
        pass
    finally:
        db.close()
