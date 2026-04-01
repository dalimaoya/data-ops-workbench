"""Notification endpoints (v2.3)."""

from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Notification, UserAccount, _now_bjt
from app.utils.auth import get_current_user
from app.i18n import t

router = APIRouter(prefix="/api/notifications", tags=["通知"])


@router.get("")
def list_notifications(
    unread: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Get notifications for current user."""
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread is True:
        q = q.filter(Notification.is_read == 0)
    elif unread is False:
        q = q.filter(Notification.is_read == 1)

    total = q.count()
    unread_count = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.is_read == 0,
    ).count()

    rows = q.order_by(Notification.id.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "title": r.title,
            "message": r.message,
            "type": r.type,
            "is_read": r.is_read,
            "related_url": r.related_url,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "unread_count": unread_count, "items": items}


@router.put("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Mark a single notification as read."""
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ).first()
    if not n:
        raise HTTPException(404, t("notification.not_found"))
    n.is_read = 1
    db.commit()
    return {"success": True}


@router.put("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Mark all notifications as read for current user."""
    db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.is_read == 0,
    ).update({"is_read": 1})
    db.commit()
    return {"success": True}
