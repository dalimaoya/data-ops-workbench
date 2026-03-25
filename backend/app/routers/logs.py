"""Log center endpoints: system/export/import/writeback log queries."""

from __future__ import annotations
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    SystemOperationLog, TemplateExportLog, ImportTaskLog, WritebackLog,
    DatasourceConfig, TableConfig, UserAccount, FieldChangeLog,
)
from app.utils.auth import get_current_user
from app.i18n import t

router = APIRouter(prefix="/api/logs", tags=["日志中心"])


# ─────────────────────────────────────────────
# P3-3: 系统操作日志
# ─────────────────────────────────────────────

@router.get("/system")
def list_system_logs(
    operation_module: Optional[str] = None,
    operation_type: Optional[str] = None,
    operator_user: Optional[str] = None,
    operation_status: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """系统操作日志查询（支持按模块/类型/操作人/时间范围/状态筛选，分页）。"""
    q = db.query(SystemOperationLog)

    # v2.2: non-admin users only see their own logs
    if user.role != "admin":
        q = q.filter(SystemOperationLog.operator_user == user.username)

    if operation_module:
        q = q.filter(SystemOperationLog.operation_module.contains(operation_module))
    if operation_type:
        q = q.filter(SystemOperationLog.operation_type.contains(operation_type))
    if operator_user:
        q = q.filter(SystemOperationLog.operator_user.contains(operator_user))
    if operation_status:
        q = q.filter(SystemOperationLog.operation_status == operation_status)
    if start_time:
        try:
            q = q.filter(SystemOperationLog.created_at >= datetime.fromisoformat(start_time))
        except ValueError:
            pass
    if end_time:
        try:
            q = q.filter(SystemOperationLog.created_at <= datetime.fromisoformat(end_time))
        except ValueError:
            pass

    total = q.count()
    rows = q.order_by(SystemOperationLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "operation_type": r.operation_type,
            "operation_module": r.operation_module,
            "target_id": r.target_id,
            "target_code": r.target_code,
            "target_name": r.target_name,
            "operation_status": r.operation_status,
            "operation_message": r.operation_message,
            "request_method": r.request_method,
            "request_path": r.request_path,
            "operator_user": r.operator_user,
            "operator_ip": r.operator_ip,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "items": items}


# ─────────────────────────────────────────────
# P3-3: 模板导出日志
# ─────────────────────────────────────────────

@router.get("/export")
def list_export_logs(
    datasource_id: Optional[int] = None,
    table_name: Optional[str] = None,
    operator_user: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """模板导出日志查询。"""
    q = db.query(TemplateExportLog)

    # v2.2: non-admin users only see their own logs
    if user.role != "admin":
        q = q.filter(TemplateExportLog.operator_user == user.username)

    if datasource_id:
        q = q.filter(TemplateExportLog.datasource_id == datasource_id)
    if operator_user:
        q = q.filter(TemplateExportLog.operator_user.contains(operator_user))
    if start_time:
        try:
            q = q.filter(TemplateExportLog.created_at >= datetime.fromisoformat(start_time))
        except ValueError:
            pass
    if end_time:
        try:
            q = q.filter(TemplateExportLog.created_at <= datetime.fromisoformat(end_time))
        except ValueError:
            pass

    # If filtering by table_name, need to join through table_config
    if table_name:
        tc_ids = [
            tc.id for tc in
            db.query(TableConfig).filter(
                TableConfig.table_name.contains(table_name),
                TableConfig.is_deleted == 0,
            ).all()
        ]
        if tc_ids:
            q = q.filter(TemplateExportLog.table_config_id.in_(tc_ids))
        else:
            return {"total": 0, "items": []}

    total = q.count()
    rows = q.order_by(TemplateExportLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in rows:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == r.datasource_id).first()
        tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()
        items.append({
            "id": r.id,
            "export_batch_no": r.export_batch_no,
            "datasource_id": r.datasource_id,
            "datasource_name": ds.datasource_name if ds else None,
            "table_config_id": r.table_config_id,
            "table_name": tc.table_name if tc else None,
            "table_alias": tc.table_alias if tc else None,
            "export_type": r.export_type,
            "row_count": r.row_count,
            "field_count": r.field_count,
            "template_version": r.template_version,
            "file_name": r.file_name,
            "operator_user": r.operator_user,
            "remark": r.remark,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "items": items}


# ─────────────────────────────────────────────
# P3-3: 模板导入日志
# ─────────────────────────────────────────────

@router.get("/import")
def list_import_logs(
    datasource_id: Optional[int] = None,
    table_name: Optional[str] = None,
    operator_user: Optional[str] = None,
    validation_status: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """模板导入日志查询。"""
    q = db.query(ImportTaskLog)

    # v2.2: non-admin users only see their own logs
    if user.role != "admin":
        q = q.filter(ImportTaskLog.operator_user == user.username)

    if datasource_id:
        q = q.filter(ImportTaskLog.datasource_id == datasource_id)
    if operator_user:
        q = q.filter(ImportTaskLog.operator_user.contains(operator_user))
    if validation_status:
        q = q.filter(ImportTaskLog.validation_status == validation_status)
    if start_time:
        try:
            q = q.filter(ImportTaskLog.created_at >= datetime.fromisoformat(start_time))
        except ValueError:
            pass
    if end_time:
        try:
            q = q.filter(ImportTaskLog.created_at <= datetime.fromisoformat(end_time))
        except ValueError:
            pass

    if table_name:
        tc_ids = [
            tc.id for tc in
            db.query(TableConfig).filter(
                TableConfig.table_name.contains(table_name),
                TableConfig.is_deleted == 0,
            ).all()
        ]
        if tc_ids:
            q = q.filter(ImportTaskLog.table_config_id.in_(tc_ids))
        else:
            return {"total": 0, "items": []}

    total = q.count()
    rows = q.order_by(ImportTaskLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in rows:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == r.datasource_id).first()
        tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()
        items.append({
            "id": r.id,
            "import_batch_no": r.import_batch_no,
            "datasource_id": r.datasource_id,
            "datasource_name": ds.datasource_name if ds else None,
            "table_config_id": r.table_config_id,
            "table_name": tc.table_name if tc else None,
            "table_alias": tc.table_alias if tc else None,
            "import_file_name": r.import_file_name,
            "template_version": r.template_version,
            "total_row_count": r.total_row_count,
            "passed_row_count": r.passed_row_count,
            "warning_row_count": r.warning_row_count,
            "failed_row_count": r.failed_row_count,
            "diff_row_count": r.diff_row_count,
            "validation_status": r.validation_status,
            "validation_message": r.validation_message,
            "import_status": r.import_status,
            "operator_user": r.operator_user,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "items": items}


# ─────────────────────────────────────────────
# P3-3: 回写日志
# ─────────────────────────────────────────────

@router.get("/writeback")
def list_writeback_logs(
    datasource_id: Optional[int] = None,
    table_name: Optional[str] = None,
    operator_user: Optional[str] = None,
    writeback_status: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """回写日志查询。"""
    q = db.query(WritebackLog)

    # v2.2: non-admin users only see their own logs
    if user.role != "admin":
        q = q.filter(WritebackLog.operator_user == user.username)

    if datasource_id:
        q = q.filter(WritebackLog.datasource_id == datasource_id)
    if operator_user:
        q = q.filter(WritebackLog.operator_user.contains(operator_user))
    if writeback_status:
        q = q.filter(WritebackLog.writeback_status == writeback_status)
    if start_time:
        try:
            q = q.filter(WritebackLog.created_at >= datetime.fromisoformat(start_time))
        except ValueError:
            pass
    if end_time:
        try:
            q = q.filter(WritebackLog.created_at <= datetime.fromisoformat(end_time))
        except ValueError:
            pass

    if table_name:
        tc_ids = [
            tc.id for tc in
            db.query(TableConfig).filter(
                TableConfig.table_name.contains(table_name),
                TableConfig.is_deleted == 0,
            ).all()
        ]
        if tc_ids:
            q = q.filter(WritebackLog.table_config_id.in_(tc_ids))
        else:
            return {"total": 0, "items": []}

    total = q.count()
    rows = q.order_by(WritebackLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in rows:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == r.datasource_id).first()
        tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()
        # Get import file name
        import_task = db.query(ImportTaskLog).filter(ImportTaskLog.id == r.import_task_id).first()
        items.append({
            "id": r.id,
            "writeback_batch_no": r.writeback_batch_no,
            "import_task_id": r.import_task_id,
            "datasource_id": r.datasource_id,
            "datasource_name": ds.datasource_name if ds else None,
            "table_config_id": r.table_config_id,
            "table_name": tc.table_name if tc else None,
            "table_alias": tc.table_alias if tc else None,
            "backup_version_no": r.backup_version_no,
            "file_name": import_task.import_file_name if import_task else None,
            "total_row_count": r.total_row_count,
            "success_row_count": r.success_row_count,
            "failed_row_count": r.failed_row_count,
            "skipped_row_count": r.skipped_row_count,
            "writeback_status": r.writeback_status,
            "writeback_message": r.writeback_message,
            "operator_user": r.operator_user,
            "inserted_row_count": r.inserted_row_count,
            "updated_row_count": r.updated_row_count,
            "deleted_row_count": r.deleted_row_count,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "items": items}


# ─────────────────────────────────────────────
# v2.0: 逐字段变更明细日志
# ─────────────────────────────────────────────

@router.get("/writeback/{writeback_log_id}/field-changes")
def list_field_changes(
    writeback_log_id: int,
    field_name: Optional[str] = None,
    change_type: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """查询某次回写的逐字段变更明细。"""
    wb = db.query(WritebackLog).filter(WritebackLog.id == writeback_log_id).first()
    if not wb:
        raise HTTPException(404, t("log.writeback_not_found"))

    q = db.query(FieldChangeLog).filter(FieldChangeLog.writeback_log_id == writeback_log_id)
    if field_name:
        q = q.filter(FieldChangeLog.field_name == field_name)
    if change_type:
        q = q.filter(FieldChangeLog.change_type == change_type)

    total = q.count()
    rows = q.order_by(FieldChangeLog.id).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "writeback_log_id": r.writeback_log_id,
            "row_pk_value": r.row_pk_value,
            "field_name": r.field_name,
            "old_value": r.old_value,
            "new_value": r.new_value,
            "change_type": r.change_type,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "items": items}
