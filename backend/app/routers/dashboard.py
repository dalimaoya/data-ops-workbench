"""Dashboard endpoints: stats, recent operations, alerts, trends, health, top tables."""

import re
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, String, case

from app.database import get_db
from app.models import (
    DatasourceConfig, TableConfig, TemplateExportLog,
    ImportTaskLog, WritebackLog, SystemOperationLog, UserAccount,
    _now_bjt, _BJT,
)
from app.utils.auth import get_current_user
from app.i18n import t

router = APIRouter(prefix="/api/dashboard", tags=["总览"])


@router.get("/stats")
def dashboard_stats(
    user: UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """基础统计：数据源数量、已纳管表数量、今日导出/导入/回写次数。"""
    ds_count = db.query(func.count(DatasourceConfig.id)).filter(
        DatasourceConfig.is_deleted == 0
    ).scalar() or 0

    tc_count = db.query(func.count(TableConfig.id)).filter(
        TableConfig.is_deleted == 0
    ).scalar() or 0

    today_start = _now_bjt().replace(hour=0, minute=0, second=0, microsecond=0)

    export_today = db.query(func.count(TemplateExportLog.id)).filter(
        TemplateExportLog.created_at >= today_start
    ).scalar() or 0

    import_today = db.query(func.count(ImportTaskLog.id)).filter(
        ImportTaskLog.created_at >= today_start
    ).scalar() or 0

    writeback_today = db.query(func.count(WritebackLog.id)).filter(
        WritebackLog.created_at >= today_start
    ).scalar() or 0

    return {
        "datasource_count": ds_count,
        "table_count": tc_count,
        "today_export": export_today,
        "today_import": import_today,
        "today_writeback": writeback_today,
    }


@router.get("/recent-operations")
def recent_operations(
    user: UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """最近 20 条操作记录，包含表别名和详细描述。"""
    logs = (
        db.query(SystemOperationLog)
        .order_by(SystemOperationLog.id.desc())
        .limit(20)
        .all()
    )
    result = []
    for log in logs:
        # 尝试获取表别名
        table_alias = None
        if log.target_id:
            tc = db.query(TableConfig).filter(TableConfig.id == log.target_id).first()
            if tc:
                table_alias = tc.table_alias or tc.table_name

        # 构建可读描述
        readable_desc = _build_readable_desc(log, table_alias)

        result.append({
            "id": log.id,
            "operation_type": log.operation_type,
            "operation_module": log.operation_module,
            "target_name": log.target_name,
            "table_alias": table_alias,
            "operation_status": log.operation_status,
            "operation_message": log.operation_message,
            "readable_desc": readable_desc,
            "operator_user": log.operator_user,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        })
    return result


def _build_readable_desc(log: SystemOperationLog, table_alias: str = None) -> str:
    """根据操作类型构建可读描述。"""
    alias = table_alias or log.target_name or "未知表"
    msg = log.operation_message or ""
    op = log.operation_type or ""

    if "回写" in op or "执行回写" in op:
        # 从 message 中提取更新/新增数
        m = re.search(r"更新\s*(\d+).*新增\s*(\d+)", msg)
        if m:
            return "回写【{}】表，更新 {} 行，新增 {} 行".format(alias, m.group(1), m.group(2))
        return "回写【{}】表".format(alias)

    if "导出" in op:
        m = re.search(r"(\d+)\s*行", msg)
        if m:
            return "导出【{}】模板，共 {} 行".format(alias, m.group(1))
        return "导出【{}】模板".format(alias)

    if "导入" in op:
        m = re.search(r"通过\s*(\d+).*失败\s*(\d+)", msg)
        if m:
            return "导入【{}】模板，校验通过 {} 行，失败 {} 行".format(alias, m.group(1), m.group(2))
        return "导入【{}】模板".format(alias)

    if "删除" in op:
        m = re.search(r"删除\s*(\d+)\s*行", msg)
        if m:
            return "删除【{}】{} 行数据".format(alias, m.group(1))
        return "删除【{}】数据".format(alias)

    if "在线编辑" in op:
        m = re.search(r"更新\s*(\d+)", msg)
        if m:
            return "在线编辑【{}】表，更新 {} 行".format(alias, m.group(1))
        return "在线编辑【{}】表".format(alias)

    if "在线新增" in op:
        return "在线新增【{}】1 行数据".format(alias)

    # 其他操作保持原始 message
    if msg:
        return msg
    return "{} - {}".format(op, alias)


@router.get("/alerts")
def dashboard_alerts(
    user: UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """待处理提醒：表结构变化提醒、导入失败提醒。"""
    alerts = []

    # 表结构变化
    changed_tables = (
        db.query(TableConfig)
        .filter(
            TableConfig.is_deleted == 0,
            TableConfig.structure_check_status == "changed",
        )
        .all()
    )
    for tc in changed_tables:
        alerts.append({
            "type": "structure_changed",
            "level": "warning",
            "title": t("dashboard.structure_change_title"),
            "message": t("dashboard.structure_change_msg", name=tc.table_alias or tc.table_name),
            "target_id": tc.id,
            "table_config_id": tc.id,
            "target_name": tc.table_name,
            "created_at": tc.last_structure_check_at.isoformat() if tc.last_structure_check_at else None,
        })

    # 最近 7 天导入失败且未处理（import_status 不是 confirmed）
    week_ago = _now_bjt() - timedelta(days=7)
    failed_imports = (
        db.query(ImportTaskLog)
        .filter(
            ImportTaskLog.validation_status == "failed",
            ImportTaskLog.import_status != "confirmed",
            ImportTaskLog.created_at >= week_ago,
        )
        .order_by(ImportTaskLog.id.desc())
        .limit(5)
        .all()
    )
    for imp in failed_imports:
        tc = db.query(TableConfig).filter(TableConfig.id == imp.table_config_id).first()
        table_label = tc.table_alias or tc.table_name if tc else "未知表"
        alerts.append({
            "type": "import_failed",
            "level": "error",
            "title": t("dashboard.import_validation_fail_title"),
            "message": t("dashboard.import_fail_msg", file=imp.import_file_name, table=table_label, count=imp.failed_row_count),
            "target_id": imp.id,
            "table_config_id": imp.table_config_id,
            "target_name": imp.import_file_name,
            "created_at": imp.created_at.isoformat() if imp.created_at else None,
        })

    return alerts


@router.get("/trends")
def dashboard_trends(
    user: UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """最近 7 天操作趋势：每天的导出、导入、回写次数。"""
    now = _now_bjt()
    # 7 天前的 00:00:00
    start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)

    # 预填 7 天数据
    days = []  # type: List[Dict[str, Any]]
    for i in range(7):
        d = start + timedelta(days=i)
        days.append({
            "date": d.strftime("%m-%d"),
            "export": 0,
            "import": 0,
            "writeback": 0,
        })

    # 辅助：date string -> index
    date_idx = {d["date"]: i for i, d in enumerate(days)}

    # 导出趋势
    export_rows = (
        db.query(
            func.strftime("%m-%d", TemplateExportLog.created_at).label("day"),
            func.count(TemplateExportLog.id).label("cnt"),
        )
        .filter(TemplateExportLog.created_at >= start)
        .group_by("day")
        .all()
    )
    for row in export_rows:
        if row.day in date_idx:
            days[date_idx[row.day]]["export"] = row.cnt

    # 导入趋势
    import_rows = (
        db.query(
            func.strftime("%m-%d", ImportTaskLog.created_at).label("day"),
            func.count(ImportTaskLog.id).label("cnt"),
        )
        .filter(ImportTaskLog.created_at >= start)
        .group_by("day")
        .all()
    )
    for row in import_rows:
        if row.day in date_idx:
            days[date_idx[row.day]]["import"] = row.cnt

    # 回写趋势
    wb_rows = (
        db.query(
            func.strftime("%m-%d", WritebackLog.created_at).label("day"),
            func.count(WritebackLog.id).label("cnt"),
        )
        .filter(WritebackLog.created_at >= start)
        .group_by("day")
        .all()
    )
    for row in wb_rows:
        if row.day in date_idx:
            days[date_idx[row.day]]["writeback"] = row.cnt

    return days


@router.get("/datasource-health")
def datasource_health(
    user: UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """各数据源最近连接测试状态。"""
    sources = (
        db.query(DatasourceConfig)
        .filter(DatasourceConfig.is_deleted == 0)
        .order_by(DatasourceConfig.id)
        .all()
    )
    result = []
    for ds in sources:
        status = "untested"
        if ds.last_test_status == "success":
            status = "ok"
        elif ds.last_test_status and ds.last_test_status != "success":
            status = "error"

        result.append({
            "id": ds.id,
            "name": ds.datasource_name,
            "code": ds.datasource_code,
            "db_type": ds.db_type,
            "status": status,
            "last_test_status": ds.last_test_status,
            "last_test_message": ds.last_test_message,
            "last_test_at": ds.last_test_at.isoformat() if ds.last_test_at else None,
        })
    return result


@router.get("/top-tables")
def dashboard_top_tables(
    user: UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """最近 7 天操作最频繁的表 Top 5。"""
    now = _now_bjt()
    week_ago = now - timedelta(days=7)

    # 从 SystemOperationLog 统计，target_id 对应 table_config_id
    rows = (
        db.query(
            SystemOperationLog.target_id,
            func.count(SystemOperationLog.id).label("op_count"),
        )
        .filter(
            SystemOperationLog.created_at >= week_ago,
            SystemOperationLog.target_id.isnot(None),
            SystemOperationLog.target_id != 0,
        )
        .group_by(SystemOperationLog.target_id)
        .order_by(func.count(SystemOperationLog.id).desc())
        .limit(5)
        .all()
    )

    result = []
    for row in rows:
        tc = db.query(TableConfig).filter(TableConfig.id == row.target_id).first()
        table_name = tc.table_alias or tc.table_name if tc else "未知表"
        ds_name = None
        if tc:
            ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == tc.datasource_id).first()
            ds_name = ds.datasource_name if ds else None
        result.append({
            "table_config_id": row.target_id,
            "table_name": table_name,
            "datasource_name": ds_name,
            "op_count": row.op_count,
        })
    return result
