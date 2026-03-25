"""v3.0-P2: Data source health check — run / history / config."""

from __future__ import annotations
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    DatasourceConfig, TableConfig, FieldConfig, HealthCheckResult, HealthCheckConfig,
    UserAccount, Notification,
)
from app.utils.auth import get_current_user, require_role
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect, list_columns
from app.i18n import t

router = APIRouter(prefix="/api/health-check", tags=["Health Check"])

_BJT = timezone(timedelta(hours=8))


def _now_bjt():
    return datetime.now(_BJT)


def _gen_batch_no():
    return f"HC_{datetime.now(_BJT).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:4].upper()}"


def _compute_structure_hash(columns: list) -> str:
    """Compute a hash of column definitions for change detection."""
    parts = []
    for col in columns:
        parts.append(f"{col.get('column_name','')}:{col.get('data_type','')}")
    return hashlib.md5("|".join(sorted(parts)).encode()).hexdigest()


# ── Run Health Check ──

@router.post("/run")
def run_health_check(
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Execute health check on all enabled data sources."""
    batch_no = _gen_batch_no()
    results_out = []
    datasources = db.query(DatasourceConfig).filter(
        DatasourceConfig.is_deleted == 0,
        DatasourceConfig.status != "disabled",
    ).all()

    # Get slow threshold from config
    cfg = db.query(HealthCheckConfig).first()
    slow_threshold = cfg.slow_threshold_ms if cfg else 5000

    for ds in datasources:
        password = decrypt_password(ds.password_encrypted)

        # 1. Connection test
        conn = None
        t0 = time.time()
        try:
            conn = _connect(
                ds.db_type, ds.host, ds.port, ds.username, password,
                database=ds.database_name, schema=ds.schema_name,
                charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
            )
            elapsed_ms = int((time.time() - t0) * 1000)
            conn_status = "ok"
            conn_msg = f"连接成功 ({elapsed_ms}ms)"
        except Exception as e:
            elapsed_ms = int((time.time() - t0) * 1000)
            conn_status = "error"
            conn_msg = f"连接失败: {str(e)[:200]}"

        r_conn = HealthCheckResult(
            check_batch_no=batch_no,
            datasource_id=ds.id,
            check_item="connection",
            check_status=conn_status,
            check_message=conn_msg,
            response_time_ms=elapsed_ms,
            operator_user=user.username,
        )
        db.add(r_conn)
        results_out.append({
            "datasource_id": ds.id,
            "datasource_name": ds.datasource_name,
            "check_item": "connection",
            "status": conn_status,
            "message": conn_msg,
            "response_time_ms": elapsed_ms,
        })

        # Response time check
        resp_status = "ok" if elapsed_ms <= slow_threshold else "warning"
        resp_msg = f"响应时间 {elapsed_ms}ms" + (f" (超过阈值 {slow_threshold}ms)" if resp_status == "warning" else "")
        r_resp = HealthCheckResult(
            check_batch_no=batch_no,
            datasource_id=ds.id,
            check_item="response_time",
            check_status=resp_status,
            check_message=resp_msg,
            response_time_ms=elapsed_ms,
            operator_user=user.username,
        )
        db.add(r_resp)
        results_out.append({
            "datasource_id": ds.id,
            "datasource_name": ds.datasource_name,
            "check_item": "response_time",
            "status": resp_status,
            "message": resp_msg,
            "response_time_ms": elapsed_ms,
        })

        if conn_status == "error":
            # Mark datasource unreachable — notify admin
            _create_notification(db, user.id, f"数据源「{ds.datasource_name}」不可达", conn_msg, "error")
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            continue

        # Check each managed table under this datasource
        tables = db.query(TableConfig).filter(
            TableConfig.datasource_id == ds.id,
            TableConfig.is_deleted == 0,
            TableConfig.status != "disabled",
        ).all()

        for tc in tables:
            # 2. Table exists check
            try:
                cols = list_columns(
                    ds.db_type, ds.host, ds.port, ds.username, password,
                    tc.table_name, database_name=ds.database_name,
                    schema_name=tc.schema_name or ds.schema_name,
                    charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
                )
                table_exists = len(cols) > 0
            except Exception:
                table_exists = False
                cols = []

            te_status = "ok" if table_exists else "error"
            te_msg = "源表存在" if table_exists else "源表不存在"
            r_te = HealthCheckResult(
                check_batch_no=batch_no,
                datasource_id=ds.id,
                table_config_id=tc.id,
                check_item="table_exists",
                check_status=te_status,
                check_message=te_msg,
                operator_user=user.username,
            )
            db.add(r_te)
            results_out.append({
                "datasource_id": ds.id,
                "datasource_name": ds.datasource_name,
                "table_config_id": tc.id,
                "table_name": tc.table_alias or tc.table_name,
                "check_item": "table_exists",
                "status": te_status,
                "message": te_msg,
            })

            if not table_exists:
                # Mark table as source_not_found
                tc.structure_check_status = "source_not_found"
                _create_notification(db, user.id, f"源表不存在：{tc.table_name}", f"数据源「{ds.datasource_name}」中的表「{tc.table_name}」不存在", "error")
                continue

            # 3. Structure change check
            new_hash = _compute_structure_hash(cols)
            old_hash = tc.structure_version_hash
            if old_hash and new_hash != old_hash:
                struct_status = "warning"
                struct_msg = "表结构发生变化"
                detail = json.dumps({"old_hash": old_hash, "new_hash": new_hash})
            else:
                struct_status = "ok"
                struct_msg = "表结构无变化"
                detail = None

            r_struct = HealthCheckResult(
                check_batch_no=batch_no,
                datasource_id=ds.id,
                table_config_id=tc.id,
                check_item="structure",
                check_status=struct_status,
                check_message=struct_msg,
                detail_json=detail,
                operator_user=user.username,
            )
            db.add(r_struct)
            results_out.append({
                "datasource_id": ds.id,
                "datasource_name": ds.datasource_name,
                "table_config_id": tc.id,
                "table_name": tc.table_alias or tc.table_name,
                "check_item": "structure",
                "status": struct_status,
                "message": struct_msg,
            })

            if struct_status == "warning":
                _create_notification(db, user.id, f"表结构变化：{tc.table_name}", struct_msg, "warning")

            # 4. Row count trend
            try:
                row_count = _count_rows(conn, ds.db_type, tc.table_name, tc.schema_name or ds.schema_name)
                r_rc = HealthCheckResult(
                    check_batch_no=batch_no,
                    datasource_id=ds.id,
                    table_config_id=tc.id,
                    check_item="row_count",
                    check_status="info",
                    check_message=f"当前行数: {row_count}",
                    detail_json=json.dumps({"row_count": row_count}),
                    operator_user=user.username,
                )
                db.add(r_rc)
                results_out.append({
                    "datasource_id": ds.id,
                    "datasource_name": ds.datasource_name,
                    "table_config_id": tc.id,
                    "table_name": tc.table_alias or tc.table_name,
                    "check_item": "row_count",
                    "status": "info",
                    "message": f"当前行数: {row_count}",
                    "row_count": row_count,
                })
            except Exception:
                pass

        # Close connection
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    db.commit()

    # Summary
    total = len(results_out)
    errors = sum(1 for r in results_out if r["status"] == "error")
    warnings = sum(1 for r in results_out if r["status"] == "warning")

    return {
        "batch_no": batch_no,
        "total_checks": total,
        "errors": errors,
        "warnings": warnings,
        "datasource_count": len(datasources),
        "results": results_out,
    }


def _count_rows(conn, db_type: str, table_name: str, schema_name: Optional[str] = None) -> int:
    """Count rows in a table using an existing connection."""
    cursor = conn.cursor()
    if db_type in ("postgresql", "kingbase") and schema_name:
        sql = f'SELECT COUNT(*) FROM "{schema_name}"."{table_name}"'
    elif db_type == "sqlserver" and schema_name:
        sql = f"SELECT COUNT(*) FROM [{schema_name}].[{table_name}]"
    elif db_type == "oracle":
        sql = f'SELECT COUNT(*) FROM "{table_name}"'
    else:
        sql = f"SELECT COUNT(*) FROM `{table_name}`" if db_type == "mysql" else f"SELECT COUNT(*) FROM \"{table_name}\""
    cursor.execute(sql)
    row = cursor.fetchone()
    cursor.close()
    return row[0] if row else 0


def _create_notification(db: Session, user_id: int, title: str, message: str, level: str):
    """Create a notification for the admin."""
    notif = Notification(
        user_id=user_id,
        title=title,
        message=message,
        type=level,
    )
    db.add(notif)


# ── History ──

@router.get("/history")
def health_check_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    datasource_id: Optional[int] = None,
    check_status: Optional[str] = None,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Query health check history."""
    q = db.query(HealthCheckResult)
    if datasource_id:
        q = q.filter(HealthCheckResult.datasource_id == datasource_id)
    if check_status:
        q = q.filter(HealthCheckResult.check_status == check_status)

    total = q.count()
    rows = q.order_by(HealthCheckResult.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    ds_cache: Dict[int, str] = {}
    tc_cache: Dict[int, str] = {}

    items = []
    for r in rows:
        if r.datasource_id not in ds_cache:
            ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == r.datasource_id).first()
            ds_cache[r.datasource_id] = ds.datasource_name if ds else ""
        if r.table_config_id and r.table_config_id not in tc_cache:
            tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()
            tc_cache[r.table_config_id] = (tc.table_alias or tc.table_name) if tc else ""

        items.append({
            "id": r.id,
            "check_batch_no": r.check_batch_no,
            "datasource_id": r.datasource_id,
            "datasource_name": ds_cache.get(r.datasource_id, ""),
            "table_config_id": r.table_config_id,
            "table_name": tc_cache.get(r.table_config_id, "") if r.table_config_id else None,
            "check_item": r.check_item,
            "check_status": r.check_status,
            "check_message": r.check_message,
            "response_time_ms": r.response_time_ms,
            "detail_json": r.detail_json,
            "operator_user": r.operator_user,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    # Get unique batch list for summary
    batches = db.query(HealthCheckResult.check_batch_no).distinct().order_by(HealthCheckResult.check_batch_no.desc()).limit(10).all()
    batch_list = [b[0] for b in batches]

    return {"total": total, "items": items, "recent_batches": batch_list}


# ── Config ──

class HealthCheckConfigUpdate(BaseModel):
    check_interval_minutes: Optional[int] = None
    auto_check_enabled: Optional[bool] = None
    notify_on_error: Optional[bool] = None
    slow_threshold_ms: Optional[int] = None


@router.get("/config")
def get_health_config(
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Get health check configuration."""
    cfg = db.query(HealthCheckConfig).first()
    if not cfg:
        cfg = HealthCheckConfig(updated_by=user.username)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return {
        "check_interval_minutes": cfg.check_interval_minutes,
        "auto_check_enabled": bool(cfg.auto_check_enabled),
        "notify_on_error": bool(cfg.notify_on_error),
        "slow_threshold_ms": cfg.slow_threshold_ms,
    }


@router.put("/config")
def update_health_config(
    body: HealthCheckConfigUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Update health check configuration."""
    cfg = db.query(HealthCheckConfig).first()
    if not cfg:
        cfg = HealthCheckConfig(updated_by=user.username)
        db.add(cfg)
        db.flush()

    if body.check_interval_minutes is not None:
        cfg.check_interval_minutes = body.check_interval_minutes
    if body.auto_check_enabled is not None:
        cfg.auto_check_enabled = 1 if body.auto_check_enabled else 0
    if body.notify_on_error is not None:
        cfg.notify_on_error = 1 if body.notify_on_error else 0
    if body.slow_threshold_ms is not None:
        cfg.slow_threshold_ms = body.slow_threshold_ms

    cfg.updated_by = user.username
    db.commit()
    return {"message": "巡检配置已更新"}
