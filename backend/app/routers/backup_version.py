"""Backup version management: list, detail, rollback."""

from __future__ import annotations
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    TableBackupVersion, TableConfig, DatasourceConfig, WritebackLog,
    SystemOperationLog, _now_bjt,
)
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.utils.auth import get_current_user, require_role
from app.models import UserAccount
from app.i18n import t

router = APIRouter(prefix="/api/backup-versions", tags=["版本回退"])


def _qualified_table(db_type: str, table_name: str, schema: Optional[str]) -> str:
    if db_type in ("postgresql", "kingbase"):
        sch = schema or "public"
        return f'"{sch}"."{table_name}"'
    elif db_type == "sqlserver":
        sch = schema or "dbo"
        return f"[{sch}].[{table_name}]"
    elif db_type in ("oracle", "dm"):
        return f'"{table_name.upper()}"'
    return f"`{table_name}`"


def _gen_batch(prefix: str) -> str:
    import uuid
    ts = _now_bjt().strftime("%Y%m%d%H%M%S")
    rand = uuid.uuid4().hex[:4].upper()
    return f"{prefix}_{ts}_{rand}"


def _log_operation(db: Session, module: str, op_type: str, target_id: Optional[int],
                   target_name: Optional[str], status: str, message: Optional[str] = None,
                   operator: str = "admin"):
    log = SystemOperationLog(
        operation_type=op_type,
        operation_module=module,
        target_id=target_id,
        target_name=target_name,
        operation_status=status,
        operation_message=message,
        operator_user=operator,
    )
    db.add(log)


@router.get("")
def list_backup_versions(
    datasource_id: Optional[int] = None,
    table_name: Optional[str] = None,
    operator_user: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """备份版本列表（支持按数据源/表名/时间范围/操作人筛选）。"""
    q = db.query(TableBackupVersion)

    if datasource_id:
        q = q.filter(TableBackupVersion.datasource_id == datasource_id)
    if table_name:
        q = q.filter(TableBackupVersion.source_table_name.contains(table_name))
    if operator_user:
        q = q.filter(TableBackupVersion.operator_user.contains(operator_user))
    if start_time:
        try:
            st = datetime.fromisoformat(start_time)
            q = q.filter(TableBackupVersion.created_at >= st)
        except ValueError:
            pass
    if end_time:
        try:
            et = datetime.fromisoformat(end_time)
            q = q.filter(TableBackupVersion.created_at <= et)
        except ValueError:
            pass

    total = q.count()
    rows = q.order_by(TableBackupVersion.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in rows:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == r.datasource_id).first()
        tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()
        items.append({
            "id": r.id,
            "backup_version_no": r.backup_version_no,
            "datasource_id": r.datasource_id,
            "datasource_name": ds.datasource_name if ds else None,
            "table_config_id": r.table_config_id,
            "table_name": r.source_table_name,
            "table_alias": tc.table_alias if tc else None,
            "backup_table_name": r.backup_table_name,
            "backup_time": r.created_at.isoformat() if r.created_at else None,
            "trigger_type": r.trigger_type,
            "related_writeback_batch_no": r.related_writeback_batch_no,
            "record_count": r.record_count,
            "storage_status": r.storage_status,
            "can_rollback": r.can_rollback,
            "operator_user": r.operator_user,
        })

    return {"total": total, "items": items}


@router.get("/{version_id}")
def get_backup_version_detail(version_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    """备份版本详情。"""
    r = db.query(TableBackupVersion).filter(TableBackupVersion.id == version_id).first()
    if not r:
        raise HTTPException(404, t("backup.not_found"))

    ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == r.datasource_id).first()
    tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()

    # Try to find related writeback log
    wb = None
    if r.related_writeback_batch_no:
        wb = db.query(WritebackLog).filter(
            WritebackLog.writeback_batch_no == r.related_writeback_batch_no
        ).first()

    return {
        "id": r.id,
        "backup_version_no": r.backup_version_no,
        "datasource_id": r.datasource_id,
        "datasource_name": ds.datasource_name if ds else None,
        "db_type": ds.db_type if ds else None,
        "table_config_id": r.table_config_id,
        "table_name": r.source_table_name,
        "table_alias": tc.table_alias if tc else None,
        "source_db_name": r.source_db_name,
        "source_schema_name": r.source_schema_name,
        "backup_table_name": r.backup_table_name,
        "trigger_type": r.trigger_type,
        "related_writeback_batch_no": r.related_writeback_batch_no,
        "record_count": r.record_count,
        "storage_status": r.storage_status,
        "can_rollback": r.can_rollback,
        "backup_started_at": r.backup_started_at.isoformat() if r.backup_started_at else None,
        "backup_finished_at": r.backup_finished_at.isoformat() if r.backup_finished_at else None,
        "operator_user": r.operator_user,
        "remark": r.remark,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "writeback_info": {
            "writeback_batch_no": wb.writeback_batch_no,
            "total_row_count": wb.total_row_count,
            "success_row_count": wb.success_row_count,
            "failed_row_count": wb.failed_row_count,
            "writeback_status": wb.writeback_status,
            "started_at": wb.started_at.isoformat() if wb and wb.started_at else None,
            "finished_at": wb.finished_at.isoformat() if wb and wb.finished_at else None,
        } if wb else None,
    }


@router.post("/{version_id}/rollback")
def rollback_version(version_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    """执行回退：先备份当前数据，再从备份表恢复到原表，记录日志。"""
    bv = db.query(TableBackupVersion).filter(TableBackupVersion.id == version_id).first()
    if not bv:
        raise HTTPException(404, t("backup.not_found"))
    if not bv.can_rollback:
        raise HTTPException(400, t("backup.not_rollbackable"))
    if bv.storage_status != "valid":
        raise HTTPException(400, t("backup.status_abnormal", status=bv.storage_status))

    tc = db.query(TableConfig).filter(TableConfig.id == bv.table_config_id).first()
    if not tc:
        raise HTTPException(404, t("backup.table_config_not_found"))
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == bv.datasource_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not ds:
        raise HTTPException(404, t("backup.datasource_not_found"))

    pwd = decrypt_password(ds.password_encrypted)
    started_at = _now_bjt()

    conn = _connect(
        ds.db_type, ds.host, ds.port, ds.username, pwd,
        tc.db_name, tc.schema_name, ds.charset, ds.connect_timeout_seconds or 10,
    )
    try:
        cur = conn.cursor()
        qt_source = _qualified_table(ds.db_type, tc.table_name, tc.schema_name)

        # ── Step 1: Backup current data before rollback ──
        import uuid as _uuid
        ts = _now_bjt().strftime("%Y%m%d_%H%M%S")
        rand_suffix = _uuid.uuid4().hex[:4].upper()
        pre_rollback_backup_name = f"{tc.table_name}_pre_rb_{ts}_{rand_suffix}"
        pre_rb_batch = _gen_batch("BK")

        if ds.db_type == "mysql":
            cur.execute(f"CREATE TABLE `{pre_rollback_backup_name}` AS SELECT * FROM {qt_source}")
        elif ds.db_type in ("postgresql", "kingbase"):
            sch = tc.schema_name or "public"
            cur.execute(f'CREATE TABLE "{sch}"."{pre_rollback_backup_name}" AS SELECT * FROM {qt_source}')
        elif ds.db_type == "sqlserver":
            sch = tc.schema_name or "dbo"
            cur.execute(f"SELECT * INTO [{sch}].[{pre_rollback_backup_name}] FROM {qt_source}")
        elif ds.db_type in ("oracle", "dm"):
            cur.execute(f'CREATE TABLE "{pre_rollback_backup_name.upper()}" AS SELECT * FROM {qt_source}')
        elif ds.db_type == "sqlite":
            cur.execute(f"CREATE TABLE `{pre_rollback_backup_name}` AS SELECT * FROM {qt_source}")

        pre_rb_qt = _qualified_table(ds.db_type, pre_rollback_backup_name, tc.schema_name)
        cur.execute(f"SELECT COUNT(*) FROM {pre_rb_qt}")

        pre_rb_count = cur.fetchone()[0]
        conn.commit()

        # Record pre-rollback backup
        pre_rb_rec = TableBackupVersion(
            backup_version_no=pre_rb_batch,
            table_config_id=tc.id,
            datasource_id=tc.datasource_id,
            backup_table_name=pre_rollback_backup_name,
            source_table_name=tc.table_name,
            source_db_name=tc.db_name,
            source_schema_name=tc.schema_name,
            trigger_type="triggered_by_rollback",
            related_writeback_batch_no=None,
            record_count=pre_rb_count,
            storage_status="valid",
            can_rollback=1,
            backup_started_at=started_at,
            backup_finished_at=_now_bjt(),
            operator_user=user.username,
            remark=f"回退前自动备份，回退目标版本: {bv.backup_version_no}",
        )
        db.add(pre_rb_rec)
        db.flush()

        # ── Step 2: Restore from backup table ──
        qt_backup = _qualified_table(ds.db_type, bv.backup_table_name, bv.source_schema_name)

        # Delete all rows from source table
        cur.execute(f"DELETE FROM {qt_source}")

        # Insert from backup table (standard SQL, works for all supported DB types)
        cur.execute(f"INSERT INTO {qt_source} SELECT * FROM {qt_backup}")

        # Count restored rows
        cur.execute(f"SELECT COUNT(*) FROM {qt_source}")
        restored_count = cur.fetchone()[0]

        conn.commit()
        finished_at = _now_bjt()

        # ── Step 3: Record rollback operation log ──
        _log_operation(
            db, "数据维护", "执行回退",
            target_id=tc.id,
            target_name=f"{tc.table_name} -> {bv.backup_version_no}",
            status="success",
            message=f"从备份版本 {bv.backup_version_no} 回退成功，恢复 {restored_count} 条记录",
            operator=user.username,
        )

        db.commit()

        return {
            "success": True,
            "message": t("backup.rollback_success", count=restored_count),
            "backup_version_no": bv.backup_version_no,
            "pre_rollback_backup_no": pre_rb_batch,
            "pre_rollback_backup_table": pre_rollback_backup_name,
            "pre_rollback_record_count": pre_rb_count,
            "restored_record_count": restored_count,
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        _log_operation(
            db, "数据维护", "执行回退",
            target_id=tc.id,
            target_name=f"{tc.table_name} -> {bv.backup_version_no}",
            status="failed",
            message=str(e),
            operator=user.username,
        )
        db.commit()
        raise HTTPException(500, t("backup.rollback_failed", error=str(e)))
    finally:
        conn.close()
