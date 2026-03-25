"""Datasource management CRUD + test-connection endpoints."""

from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import DatasourceConfig, _now_bjt
from app.schemas.datasource import (
    DatasourceCreate, DatasourceUpdate, DatasourceOut,
    TestConnectionRequest, TestConnectionResponse,
)
from app.utils.crypto import encrypt_password, decrypt_password
from app.utils.db_connector import test_connection
from app.utils.audit import log_operation
from app.utils.auth import get_current_user, require_role
from app.utils.permissions import get_permitted_datasource_ids
from app.models import UserAccount
from app.i18n import t

router = APIRouter(prefix="/api/datasource", tags=["数据源管理"])


def _gen_code(db: Session) -> str:
    today = _now_bjt().strftime("%Y%m%d")
    prefix = f"DS_{today}_"
    last = (
        db.query(DatasourceConfig)
        .filter(DatasourceConfig.datasource_code.like(f"{prefix}%"))
        .order_by(DatasourceConfig.id.desc())
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.datasource_code.split("_")[-1]) + 1
        except ValueError:
            pass
    return f"{prefix}{seq:03d}"


@router.get("", response_model=List[DatasourceOut])
def list_datasources(
    db_type: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    q = db.query(DatasourceConfig).filter(DatasourceConfig.is_deleted == 0)
    # v2.2: datasource-level permission filtering
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None:
        if not permitted_ids:
            return []
        q = q.filter(DatasourceConfig.id.in_(permitted_ids))
    if db_type:
        q = q.filter(DatasourceConfig.db_type == db_type)
    if status:
        q = q.filter(DatasourceConfig.status == status)
    if keyword:
        q = q.filter(DatasourceConfig.datasource_name.contains(keyword))
    return q.order_by(DatasourceConfig.id.desc()).offset((page - 1) * page_size).limit(page_size).all()


@router.get("/count")
def count_datasources(
    db_type: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    q = db.query(DatasourceConfig).filter(DatasourceConfig.is_deleted == 0)
    # v2.2: datasource-level permission filtering
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None:
        if not permitted_ids:
            return {"total": 0}
        q = q.filter(DatasourceConfig.id.in_(permitted_ids))
    if db_type:
        q = q.filter(DatasourceConfig.db_type == db_type)
    if status:
        q = q.filter(DatasourceConfig.status == status)
    if keyword:
        q = q.filter(DatasourceConfig.datasource_name.contains(keyword))
    return {"total": q.count()}


@router.get("/{ds_id}", response_model=DatasourceOut)
def get_datasource(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    return row


@router.post("", response_model=DatasourceOut)
def create_datasource(body: DatasourceCreate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    row = DatasourceConfig(
        datasource_code=_gen_code(db),
        datasource_name=body.datasource_name,
        db_type=body.db_type,
        host=body.host,
        port=body.port,
        database_name=body.database_name,
        schema_name=body.schema_name,
        username=body.username,
        password_encrypted=encrypt_password(body.password),
        charset=body.charset,
        connect_timeout_seconds=body.connect_timeout_seconds,
        status=body.status,
        remark=body.remark,
        created_by=user.username,
        updated_by=user.username,
    )
    db.add(row)
    db.flush()
    log_operation(db, "数据源管理", "创建数据源", "success",
                  target_id=row.id, target_code=row.datasource_code,
                  target_name=row.datasource_name,
                  message=f"创建数据源 {row.datasource_name}（{row.db_type}）",
                  operator=user.username)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{ds_id}", response_model=DatasourceOut)
def update_datasource(ds_id: int, body: DatasourceUpdate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    updates = body.model_dump(exclude_unset=True)
    if "password" in updates:
        updates["password_encrypted"] = encrypt_password(updates.pop("password"))
    for k, v in updates.items():
        setattr(row, k, v)
    row.updated_by = user.username
    row.updated_at = _now_bjt()
    log_operation(db, "数据源管理", "编辑数据源", "success",
                  target_id=row.id, target_code=row.datasource_code,
                  target_name=row.datasource_name,
                  message=f"编辑数据源 {row.datasource_name}",
                  operator=user.username)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{ds_id}")
def delete_datasource(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    row.is_deleted = 1
    row.updated_at = _now_bjt()
    log_operation(db, "数据源管理", "删除数据源", "success",
                  target_id=row.id, target_code=row.datasource_code,
                  target_name=row.datasource_name,
                  message=f"删除数据源 {row.datasource_name}",
                  operator=user.username)
    db.commit()
    return {"detail": t("datasource.deleted")}


@router.post("/test-connection", response_model=TestConnectionResponse)
def api_test_connection(body: TestConnectionRequest):
    ok, msg = test_connection(
        db_type=body.db_type, host=body.host, port=body.port,
        username=body.username, password=body.password,
        database_name=body.database_name, schema_name=body.schema_name,
        charset=body.charset, connect_timeout_seconds=body.connect_timeout_seconds,
    )
    return TestConnectionResponse(success=ok, message=msg)


@router.post("/{ds_id}/test", response_model=TestConnectionResponse)
def test_existing_datasource(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    pwd = decrypt_password(row.password_encrypted)
    ok, msg = test_connection(
        db_type=row.db_type, host=row.host, port=row.port,
        username=row.username, password=pwd,
        database_name=row.database_name, schema_name=row.schema_name,
        charset=row.charset, connect_timeout_seconds=row.connect_timeout_seconds,
    )
    row.last_test_status = "success" if ok else "failed"
    row.last_test_message = msg
    row.last_test_at = _now_bjt()
    log_operation(db, "数据源管理", "测试连接", "success" if ok else "failed",
                  target_id=row.id, target_code=row.datasource_code,
                  target_name=row.datasource_name,
                  message=f"测试连接 {row.datasource_name}: {msg}",
                  operator=user.username)
    db.commit()
    return TestConnectionResponse(success=ok, message=msg)
