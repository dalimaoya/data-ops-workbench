"""Datasource-level permission helpers (v2.2)."""

from typing import List, Optional
from sqlalchemy.orm import Session
from app.models import UserAccount, UserDatasourcePermission


def get_permitted_datasource_ids(db: Session, user: UserAccount) -> Optional[List[int]]:
    """Return list of permitted datasource IDs for the user.
    Returns None if user is admin (meaning all are permitted).
    Returns empty list if non-admin has no permissions.
    """
    if user.role in ("admin", "superadmin"):
        return None  # admin/superadmin sees everything
    rows = db.query(UserDatasourcePermission.datasource_id).filter(
        UserDatasourcePermission.user_id == user.id
    ).all()
    return [r[0] for r in rows]
