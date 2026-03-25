"""User management endpoints (admin only) + personal settings (/api/me)."""

from __future__ import annotations
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UserAccount, UserDatasourcePermission, DatasourceConfig, _now_bjt
from app.utils.auth import (
    get_current_user, require_role, hash_password, verify_password,
    needs_password_migration,
)
from app.utils.security_middleware import login_lockout
from app.utils.audit import log_operation
from app.i18n import t

router = APIRouter(tags=["用户管理"])


def validate_password_strength(password: str) -> None:
    """Validate password strength: ≥8 chars, uppercase, lowercase, digit."""
    if len(password) < 8:
        raise HTTPException(400, t("user.password_too_short"))
    if not re.search(r'[A-Z]', password):
        raise HTTPException(400, "密码必须包含至少一个大写字母")
    if not re.search(r'[a-z]', password):
        raise HTTPException(400, "密码必须包含至少一个小写字母")
    if not re.search(r'[0-9]', password):
        raise HTTPException(400, "密码必须包含至少一个数字")


# ── Schemas ──

class UserOut(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    role: str
    status: str
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str
    display_name: Optional[str] = None
    password: str
    role: str  # admin / operator / readonly


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None


class UserStatusUpdate(BaseModel):
    status: str  # enabled / disabled


class ResetPasswordRequest(BaseModel):
    new_password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    display_name: str


class DatasourcePermissionUpdate(BaseModel):
    datasource_ids: List[int]


# ── Admin: User Management (/api/users) ──

@router.get("/api/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    rows = db.query(UserAccount).order_by(UserAccount.id).all()
    result = []
    for r in rows:
        u = UserOut(
            id=r.id,
            username=r.username,
            display_name=r.display_name,
            role=r.role,
            status=r.status,
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        result.append(u)
    return result


@router.post("/api/users", response_model=UserOut)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    if body.role not in ("admin", "operator", "readonly"):
        raise HTTPException(400, t("user.role_invalid"))
    validate_password_strength(body.password)
    existing = db.query(UserAccount).filter(UserAccount.username == body.username).first()
    if existing:
        raise HTTPException(409, t("user.username_exists", username=body.username))

    new_user = UserAccount(
        username=body.username,
        display_name=body.display_name or body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        status="enabled",
    )
    db.add(new_user)
    db.flush()
    log_operation(
        db, "用户管理", "新增用户", "success",
        target_id=new_user.id,
        target_name=new_user.username,
        message=f"新增用户 {new_user.username}（{new_user.role}）",
        operator=user.username,
    )
    db.commit()
    db.refresh(new_user)
    return UserOut(
        id=new_user.id,
        username=new_user.username,
        display_name=new_user.display_name,
        role=new_user.role,
        status=new_user.status,
        created_at=new_user.created_at.isoformat() if new_user.created_at else None,
    )


@router.put("/api/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    target = db.query(UserAccount).filter(UserAccount.id == user_id).first()
    if not target:
        raise HTTPException(404, t("user.not_found"))
    if body.display_name is not None:
        target.display_name = body.display_name
    if body.role is not None:
        if body.role not in ("admin", "operator", "readonly"):
            raise HTTPException(400, t("user.role_invalid"))
        target.role = body.role
    target.updated_at = _now_bjt()
    log_operation(
        db, "用户管理", "编辑用户", "success",
        target_id=target.id,
        target_name=target.username,
        message=f"编辑用户 {target.username}",
        operator=user.username,
    )
    db.commit()
    db.refresh(target)
    return UserOut(
        id=target.id,
        username=target.username,
        display_name=target.display_name,
        role=target.role,
        status=target.status,
        created_at=target.created_at.isoformat() if target.created_at else None,
    )


@router.put("/api/users/{user_id}/status")
def update_user_status(
    user_id: int,
    body: UserStatusUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    target = db.query(UserAccount).filter(UserAccount.id == user_id).first()
    if not target:
        raise HTTPException(404, t("user.not_found"))
    if target.username == "admin" and body.status == "disabled":
        raise HTTPException(400, t("user.cannot_disable_admin"))
    if body.status not in ("enabled", "disabled"):
        raise HTTPException(400, t("user.status_invalid"))
    target.status = body.status
    target.updated_at = _now_bjt()
    action = t("user.enable") if body.status == "enabled" else t("user.disable")
    log_operation(
        db, "用户管理", action, "success",
        target_id=target.id,
        target_name=target.username,
        message=f"{action} {target.username}",
        operator=user.username,
    )
    db.commit()
    return {"detail": t("user.status_updated", action=action)}


@router.put("/api/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    target = db.query(UserAccount).filter(UserAccount.id == user_id).first()
    if not target:
        raise HTTPException(404, t("user.not_found"))
    target.password_hash = hash_password(body.new_password)
    target.updated_at = _now_bjt()
    log_operation(
        db, "用户管理", "重置密码", "success",
        target_id=target.id,
        target_name=target.username,
        message=f"重置用户 {target.username} 的密码",
        operator=user.username,
    )
    db.commit()
    return {"detail": t("user.password_reset")}


# ── Personal Settings (/api/me) ──

@router.put("/api/me/password")
def change_my_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(400, t("user.old_password_wrong"))
    validate_password_strength(body.new_password)
    user.password_hash = hash_password(body.new_password)
    user.updated_at = _now_bjt()
    log_operation(
        db, "个人设置", "修改密码", "success",
        target_id=user.id,
        target_name=user.username,
        message=f"用户 {user.username} 修改了密码",
        operator=user.username,
    )
    db.commit()
    return {"detail": t("user.password_changed")}


@router.put("/api/me/profile")
def update_my_profile(
    body: UpdateProfileRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    user.display_name = body.display_name
    user.updated_at = _now_bjt()
    log_operation(
        db, "个人设置", "修改显示名", "success",
        target_id=user.id,
        target_name=user.username,
        message=f"用户 {user.username} 修改显示名为 {body.display_name}",
        operator=user.username,
    )
    db.commit()
    return {"detail": t("user.profile_updated"), "display_name": body.display_name}


# ── Datasource Permission Management (v2.2) ──

@router.get("/api/users/{user_id}/datasource-permissions")
def get_user_datasource_permissions(
    user_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    target = db.query(UserAccount).filter(UserAccount.id == user_id).first()
    if not target:
        raise HTTPException(404, t("user.not_found"))
    perms = db.query(UserDatasourcePermission).filter(
        UserDatasourcePermission.user_id == user_id
    ).all()
    datasource_ids = [p.datasource_id for p in perms]
    # Also return all datasources for the UI checkbox list
    all_ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.is_deleted == 0
    ).order_by(DatasourceConfig.id).all()
    all_datasources = [
        {"id": ds.id, "datasource_name": ds.datasource_name, "db_type": ds.db_type}
        for ds in all_ds
    ]
    return {
        "user_id": user_id,
        "username": target.username,
        "role": target.role,
        "datasource_ids": datasource_ids,
        "all_datasources": all_datasources,
    }


@router.put("/api/users/{user_id}/datasource-permissions")
def set_user_datasource_permissions(
    user_id: int,
    body: DatasourcePermissionUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    target = db.query(UserAccount).filter(UserAccount.id == user_id).first()
    if not target:
        raise HTTPException(404, t("user.not_found"))
    # Delete existing permissions
    db.query(UserDatasourcePermission).filter(
        UserDatasourcePermission.user_id == user_id
    ).delete(synchronize_session=False)
    # Insert new permissions
    for ds_id in body.datasource_ids:
        db.add(UserDatasourcePermission(user_id=user_id, datasource_id=ds_id))
    log_operation(
        db, "用户管理", "设置数据源权限", "success",
        target_id=target.id,
        target_name=target.username,
        message="设置用户 %s 的数据源权限：%d 个数据源" % (target.username, len(body.datasource_ids)),
        operator=user.username,
    )
    db.commit()
    return {"detail": t("user.datasource_perm_updated"), "datasource_ids": body.datasource_ids}
