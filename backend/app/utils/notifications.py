"""Notification helper utilities (v2.3)."""

from __future__ import annotations
from typing import Optional, List

from sqlalchemy.orm import Session

from app.models import Notification, UserAccount, _now_bjt


def create_notification(
    db: Session,
    user_id: int,
    title: str,
    message: str,
    ntype: str = "info",
    related_url: Optional[str] = None,
) -> Notification:
    """Create a single notification for a user."""
    n = Notification(
        user_id=user_id,
        title=title,
        message=message,
        type=ntype,
        is_read=0,
        related_url=related_url,
    )
    db.add(n)
    return n


def notify_admins(
    db: Session,
    title: str,
    message: str,
    ntype: str = "info",
    related_url: Optional[str] = None,
) -> List[Notification]:
    """Create notifications for all admin users."""
    admins = db.query(UserAccount).filter(
        UserAccount.role == "admin",
        UserAccount.status == "enabled",
    ).all()
    results = []
    for admin in admins:
        results.append(create_notification(db, admin.id, title, message, ntype, related_url))
    return results


def notify_user_by_username(
    db: Session,
    username: str,
    title: str,
    message: str,
    ntype: str = "info",
    related_url: Optional[str] = None,
) -> Optional[Notification]:
    """Create a notification for a user by username."""
    user = db.query(UserAccount).filter(UserAccount.username == username).first()
    if user:
        return create_notification(db, user.id, title, message, ntype, related_url)
    return None
