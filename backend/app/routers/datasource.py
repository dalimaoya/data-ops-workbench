"""Datasource management CRUD + test-connection endpoints."""

from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import DatasourceConfig, TableConfig, FieldConfig, _now_bjt
from app.schemas.datasource import (
    DatasourceCreate, DatasourceUpdate, DatasourceOut,
    TestConnectionRequest, TestConnectionResponse,
)
from app.utils.crypto import encrypt_password, decrypt_password
from app.utils.db_connector import test_connection
from app.utils.remote_db import list_databases
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


import time as _time
import threading as _threading
from concurrent.futures import ThreadPoolExecutor as _TPE

# Cached online status: {ds_id: {"online": bool, "checked_at": float}}
_online_cache: dict = {}
_online_cache_lock = _threading.Lock()
_CACHE_TTL = 60  # seconds


def _check_one_ds(ds_id: int, db_type: str, host: str, port: int,
                   username: str, pwd: str, database_name, schema_name,
                   charset, timeout):
    """Check one datasource connection (runs in thread pool)."""
    try:
        ok, _ = test_connection(
            db_type=db_type, host=host, port=port,
            username=username, password=pwd,
            database_name=database_name, schema_name=schema_name,
            charset=charset, connect_timeout_seconds=timeout,
        )
    except Exception:
        ok = False
    with _online_cache_lock:
        _online_cache[ds_id] = {"online": ok, "checked_at": _time.time()}
    return ds_id, ok


@router.get("/online-status")
def batch_online_status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """批量检测所有数据源在线状态（并发+60s 缓存）。"""
    now = _time.time()
    sources = db.query(DatasourceConfig).filter(
        DatasourceConfig.is_deleted == 0, DatasourceConfig.status == "enabled"
    ).all()

    result = {}
    to_check = []
    with _online_cache_lock:
        for ds in sources:
            cached = _online_cache.get(ds.id)
            if cached and now - cached["checked_at"] < _CACHE_TTL:
                result[ds.id] = cached["online"]
            else:
                to_check.append(ds)

    if to_check:
        # Concurrent check with ThreadPool — max 3s per connection, max 4 workers
        futures = []
        with _TPE(max_workers=min(len(to_check), 4)) as pool:
            for ds in to_check:
                pwd = decrypt_password(ds.password_encrypted)
                futures.append(pool.submit(
                    _check_one_ds, ds.id, ds.db_type, ds.host, ds.port,
                    ds.username, pwd, ds.database_name, ds.schema_name,
                    ds.charset, min(ds.connect_timeout_seconds or 3, 3),
                ))
            for f in futures:
                try:
                    ds_id, ok = f.result(timeout=5)
                    result[ds_id] = ok
                except Exception:
                    pass

    return {"status": {str(k): v for k, v in result.items()}}


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


def _check_ds_permission(db: Session, user: UserAccount, ds_id: int):
    """Verify user has permission to access this datasource."""
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None and ds_id not in permitted_ids:
        raise HTTPException(403, t("datasource.not_found"))


@router.get("/{ds_id}", response_model=DatasourceOut)
def get_datasource(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _check_ds_permission(db, user, ds_id)
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
        host=body.host.strip(),
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
        pwd_val = updates.pop("password")
        if pwd_val:  # Only update password if non-empty
            updates["password_encrypted"] = encrypt_password(pwd_val)
    if "host" in updates and updates["host"]:
        updates["host"] = updates["host"].strip()
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


@router.get("/{ds_id}/managed-count")
def get_managed_table_count(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """查询数据源下的纳管表数量（用于删除前确认）。"""
    count = db.query(TableConfig).filter(
        TableConfig.datasource_id == ds_id, TableConfig.is_deleted == 0
    ).count()
    return {"count": count}


@router.delete("/{ds_id}")
def delete_datasource(
    ds_id: int,
    cascade: bool = Query(False, description="是否级联删除纳管表"),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    row.is_deleted = 1
    row.updated_at = _now_bjt()

    deleted_tables = 0
    if cascade:
        # Cascade soft-delete all managed tables and their fields
        tcs = db.query(TableConfig).filter(
            TableConfig.datasource_id == ds_id, TableConfig.is_deleted == 0
        ).all()
        for tc in tcs:
            tc.is_deleted = 1
            db.query(FieldConfig).filter(
                FieldConfig.table_config_id == tc.id, FieldConfig.is_deleted == 0
            ).update({"is_deleted": 1})
            deleted_tables += 1

    log_operation(db, "数据源管理", "删除数据源", "success",
                  target_id=row.id, target_code=row.datasource_code,
                  target_name=row.datasource_name,
                  message=f"删除数据源 {row.datasource_name}" + (f"，级联删除 {deleted_tables} 张纳管表" if cascade else ""),
                  operator=user.username)
    db.commit()
    return {"detail": t("datasource.deleted"), "deleted_tables": deleted_tables}


@router.post("/check-restore")
def check_restore_datasource(
    body: TestConnectionRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """检查是否存在可恢复的已删除数据源（相同 host:port:database）。"""
    match = db.query(DatasourceConfig).filter(
        DatasourceConfig.host == body.host.strip(),
        DatasourceConfig.port == body.port,
        DatasourceConfig.database_name == (body.database_name or None),
        DatasourceConfig.is_deleted == 1,
    ).first()
    if match:
        managed_count = db.query(TableConfig).filter(
            TableConfig.datasource_id == match.id, TableConfig.is_deleted == 0
        ).count()
        return {
            "found": True,
            "datasource_id": match.id,
            "datasource_name": match.datasource_name,
            "managed_count": managed_count,
        }
    return {"found": False}


@router.post("/{ds_id}/restore")
def restore_datasource(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    """恢复已删除的数据源。"""
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 1
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    row.is_deleted = 0
    row.updated_at = _now_bjt()
    row.updated_by = user.username
    log_operation(db, "数据源管理", "恢复数据源", "success",
                  target_id=row.id, target_code=row.datasource_code,
                  target_name=row.datasource_name,
                  message=f"恢复已删除数据源 {row.datasource_name}",
                  operator=user.username)
    db.commit()
    return {"detail": "数据源已恢复", "id": row.id}


@router.get("/{ds_id}/databases")
def get_datasource_databases(ds_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """列出数据源服务器上的所有可用数据库/Schema。"""
    _check_ds_permission(db, user, ds_id)
    row = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("datasource.not_found"))
    pwd = decrypt_password(row.password_encrypted)
    try:
        dbs = list_databases(
            db_type=row.db_type, host=row.host, port=row.port,
            user=row.username, password=pwd,
            charset=row.charset, timeout=row.connect_timeout_seconds or 10,
        )
    except Exception as e:
        raise HTTPException(400, f"获取数据库列表失败: {e}")
    return {"databases": dbs}


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
