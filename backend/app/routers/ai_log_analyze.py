"""v4.3: AI Log Analysis — summary / anomaly detection with risk assessment / trace."""

from __future__ import annotations
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    SystemOperationLog, WritebackLog, ImportTaskLog, FieldChangeLog,
    TableConfig, DatasourceConfig, UserAccount, TableBackupVersion,
)
from app.utils.auth import get_current_user
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Log Analysis"])

_BJT = timezone(timedelta(hours=8))


# ── Schemas ──

class TimeRange(BaseModel):
    start: str
    end: str


class LogAnalyzeRequest(BaseModel):
    action: str  # summary | anomaly | trace
    time_range: TimeRange
    table_id: Optional[int] = None
    field_name: Optional[str] = None  # for trace
    row_pk: Optional[str] = None  # for trace


# ── Helpers ──

def _parse_dt(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"Invalid datetime format: {s}")


def _table_name_map(db: Session) -> Dict[int, str]:
    tables = db.query(TableConfig).filter(TableConfig.is_deleted == 0).all()
    return {tc.id: (tc.table_alias or tc.table_name) for tc in tables}


# ── Summary ──

def _generate_summary(db: Session, start: datetime, end: datetime, table_id: Optional[int]) -> Dict[str, Any]:
    """Generate a natural-language summary of operations in the time range."""
    # Writeback logs
    wq = db.query(WritebackLog).filter(WritebackLog.created_at >= start, WritebackLog.created_at <= end)
    if table_id:
        wq = wq.filter(WritebackLog.table_config_id == table_id)
    wb_logs = wq.all()

    # Import logs
    iq = db.query(ImportTaskLog).filter(ImportTaskLog.created_at >= start, ImportTaskLog.created_at <= end)
    if table_id:
        iq = iq.filter(ImportTaskLog.table_config_id == table_id)
    import_logs = iq.all()

    # System ops
    sq = db.query(SystemOperationLog).filter(SystemOperationLog.created_at >= start, SystemOperationLog.created_at <= end)
    sys_logs = sq.all()

    tmap = _table_name_map(db)

    # Stats
    wb_by_user: Counter = Counter()
    wb_by_table: Counter = Counter()
    total_updated = 0
    total_inserted = 0
    total_deleted = 0
    for w in wb_logs:
        wb_by_user[w.operator_user] += 1
        wb_by_table[tmap.get(w.table_config_id, f"表{w.table_config_id}")] += 1
        total_updated += (w.updated_row_count or 0)
        total_inserted += (w.inserted_row_count or 0)
        total_deleted += (w.deleted_row_count or 0)

    imp_count = len(import_logs)
    wb_count = len(wb_logs)

    # Build text summary
    lines = []
    hours = max(1, int((end - start).total_seconds() / 3600))
    lines.append(f"过去 {hours} 小时内：")
    lines.append(f"• 共发生 {len(sys_logs)} 次系统操作")
    lines.append(f"• 模板导入 {imp_count} 次，回写 {wb_count} 次")
    if wb_count:
        lines.append(f"• 回写共修改 {total_updated} 行、新增 {total_inserted} 行、删除 {total_deleted} 行")
        top_users = wb_by_user.most_common(3)
        user_parts = [f"{u}({c}次)" for u, c in top_users]
        lines.append(f"• 回写最活跃用户：{', '.join(user_parts)}")
        top_tables = wb_by_table.most_common(3)
        table_parts = [f"{t_}({c}次)" for t_, c in top_tables]
        lines.append(f"• 回写最多的表：{', '.join(table_parts)}")

    # Rollback stats
    rb = db.query(TableBackupVersion).filter(
        TableBackupVersion.trigger_type == "rollback",
        TableBackupVersion.created_at >= start,
        TableBackupVersion.created_at <= end,
    ).count()
    if rb:
        lines.append(f"• 发生 {rb} 次版本回退")

    return {
        "summary_text": "\n".join(lines),
        "stats": {
            "system_ops": len(sys_logs),
            "imports": imp_count,
            "writebacks": wb_count,
            "updated_rows": total_updated,
            "inserted_rows": total_inserted,
            "deleted_rows": total_deleted,
            "rollbacks": rb,
        },
        "top_users": dict(wb_by_user.most_common(5)),
        "top_tables": dict(wb_by_table.most_common(5)),
    }


# ── Anomaly Detection ──

def _detect_anomalies(db: Session, start: datetime, end: datetime, table_id: Optional[int]) -> List[Dict[str, Any]]:
    """Rule-based anomaly detection."""
    anomalies: List[Dict[str, Any]] = []
    tmap = _table_name_map(db)

    wq = db.query(WritebackLog).filter(WritebackLog.created_at >= start, WritebackLog.created_at <= end)
    if table_id:
        wq = wq.filter(WritebackLog.table_config_id == table_id)
    wb_logs = wq.order_by(WritebackLog.created_at).all()

    # 1. Off-hours operations (22:00-07:00)
    for w in wb_logs:
        if w.created_at:
            local_hour = w.created_at.hour  # assuming BJT stored
            if local_hour >= 22 or local_hour < 7:
                anomalies.append({
                    "type": "off_hours",
                    "level": "warning",
                    "message": f"非工作时间操作：用户 {w.operator_user} 在 {w.created_at.strftime('%H:%M')} 对「{tmap.get(w.table_config_id, '')}」执行回写",
                    "detail": {"writeback_id": w.id, "user": w.operator_user, "time": w.created_at.isoformat()},
                })

    # 2. High-frequency writeback (same table >= 3 times in 1 hour)
    table_times: Dict[int, List[datetime]] = defaultdict(list)
    for w in wb_logs:
        if w.created_at:
            table_times[w.table_config_id].append(w.created_at)

    for tid_, times in table_times.items():
        times.sort()
        for i in range(len(times)):
            count_in_hour = sum(1 for t_ in times[i:] if (t_ - times[i]).total_seconds() <= 3600)
            if count_in_hour >= 3:
                anomalies.append({
                    "type": "high_frequency",
                    "level": "warning",
                    "message": f"高频回写：「{tmap.get(tid_, '')}」在 1 小时内被回写 {count_in_hour} 次",
                    "detail": {"table_id": tid_, "count": count_in_hour},
                })
                break  # only report once per table

    # 3. Bulk modification (single writeback >= 30% of table)
    for w in wb_logs:
        total_changed = (w.updated_row_count or 0) + (w.inserted_row_count or 0) + (w.deleted_row_count or 0)
        if total_changed > 0 and w.total_row_count and w.total_row_count > 0:
            ratio = total_changed / w.total_row_count
            if ratio >= 0.3:
                anomalies.append({
                    "type": "bulk_modification",
                    "level": "error",
                    "message": f"大批量修改：用户 {w.operator_user} 对「{tmap.get(w.table_config_id, '')}」修改了 {int(ratio*100)}% 的数据（{total_changed}/{w.total_row_count}行）",
                    "detail": {"writeback_id": w.id, "ratio": round(ratio, 2), "changed": total_changed},
                })

    # 4. Consecutive rollbacks (same table rolled back >= 2 times in 24h)
    rb_logs = db.query(TableBackupVersion).filter(
        TableBackupVersion.trigger_type == "rollback",
        TableBackupVersion.created_at >= start,
        TableBackupVersion.created_at <= end,
    ).all()
    rb_by_table: Counter = Counter()
    for rb in rb_logs:
        rb_by_table[rb.table_config_id] += 1
    for tid_, count in rb_by_table.items():
        if count >= 2:
            anomalies.append({
                "type": "consecutive_rollback",
                "level": "error",
                "message": f"连续回退：「{tmap.get(tid_, '')}」在时间范围内被回退 {count} 次",
                "detail": {"table_id": tid_, "rollback_count": count},
            })

    # 5. Failed imports (error status)
    failed_imports = db.query(ImportTaskLog).filter(
        ImportTaskLog.created_at >= start,
        ImportTaskLog.created_at <= end,
        ImportTaskLog.status == "error",
    ).all()
    for fi in failed_imports:
        anomalies.append({
            "type": "failed_import",
            "level": "warning",
            "message": f"导入失败：用户 {fi.operator_user or '未知'} 对「{tmap.get(fi.table_config_id, '')}」导入失败",
            "detail": {"import_id": fi.id, "user": fi.operator_user},
        })

    # Deduplicate by type+detail key
    seen = set()
    unique = []
    for a in anomalies:
        key = (a["type"], json.dumps(a.get("detail", {}), sort_keys=True))
        if key not in seen:
            seen.add(key)
            unique.append(a)

    # Sort by severity: error > warning > info
    level_order = {"error": 0, "warning": 1, "info": 2}
    unique.sort(key=lambda x: level_order.get(x.get("level", "info"), 99))

    # Generate suggestions for each anomaly
    for a in unique:
        a["suggestion"] = _get_suggestion(a["type"], a.get("detail", {}))

    return unique


_SUGGESTION_MAP = {
    "off_hours": "建议检查是否为授权操作，可考虑设置非工作时间操作审批流程",
    "high_frequency": "频繁回写可能导致数据不一致，建议合并操作或开启审批流",
    "bulk_modification": "大批量修改风险较高，建议先备份数据并在测试环境验证",
    "consecutive_rollback": "连续回退说明数据质量可能有问题，建议排查回写模板和校验规则",
    "failed_import": "导入失败可能由模板格式或数据校验引起，建议检查导入文件和字段映射",
}


def _get_suggestion(anomaly_type: str, detail: dict) -> str:
    """Generate a suggestion based on anomaly type."""
    base = _SUGGESTION_MAP.get(anomaly_type, "建议关注并人工确认操作合理性")
    if anomaly_type == "bulk_modification" and detail.get("ratio", 0) >= 0.5:
        base += "。修改超过50%数据，强烈建议审批后操作"
    return base


# ── Trace ──

def _trace_field(db: Session, start: datetime, end: datetime,
                 table_id: Optional[int], field_name: Optional[str],
                 row_pk: Optional[str]) -> List[Dict[str, Any]]:
    """Trace who last changed a specific field/row."""
    if not table_id:
        raise HTTPException(400, "问题溯源需要指定 table_id")

    # Get writeback logs for this table
    wq = db.query(WritebackLog).filter(
        WritebackLog.table_config_id == table_id,
        WritebackLog.created_at >= start,
        WritebackLog.created_at <= end,
    ).order_by(WritebackLog.created_at.desc())
    wb_logs = wq.all()

    results = []
    for w in wb_logs:
        fcq = db.query(FieldChangeLog).filter(FieldChangeLog.writeback_log_id == w.id)
        if field_name:
            fcq = fcq.filter(FieldChangeLog.field_name == field_name)
        if row_pk:
            fcq = fcq.filter(FieldChangeLog.row_pk_value == row_pk)
        changes = fcq.order_by(FieldChangeLog.id.desc()).limit(50).all()
        for c in changes:
            results.append({
                "writeback_id": w.id,
                "writeback_batch_no": w.writeback_batch_no,
                "operator_user": w.operator_user,
                "operator_time": w.created_at.isoformat() if w.created_at else None,
                "field_name": c.field_name,
                "row_pk_value": c.row_pk_value,
                "old_value": c.old_value,
                "new_value": c.new_value,
                "change_type": c.change_type,
            })

    return results[:100]  # cap


# ── Endpoint ──

@router.post("/log-analyze")
def log_analyze(
    req: LogAnalyzeRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """AI log analysis: summary / anomaly / trace."""
    start = _parse_dt(req.time_range.start)
    end = _parse_dt(req.time_range.end)

    if req.action == "summary":
        data = _generate_summary(db, start, end, req.table_id)
        return {"action": "summary", "data": data}

    elif req.action == "anomaly":
        anomalies = _detect_anomalies(db, start, end, req.table_id)
        # Overall risk assessment
        error_count = sum(1 for a in anomalies if a.get("level") == "error")
        warning_count = sum(1 for a in anomalies if a.get("level") == "warning")
        if error_count >= 2:
            overall_risk = "high"
            overall_desc = f"发现 {error_count} 个高风险项，建议立即排查"
        elif error_count >= 1 or warning_count >= 3:
            overall_risk = "medium"
            overall_desc = f"发现 {error_count} 个高风险 + {warning_count} 个中风险项，建议关注"
        elif warning_count >= 1:
            overall_risk = "low"
            overall_desc = f"发现 {warning_count} 个中风险项，整体可控"
        else:
            overall_risk = "safe"
            overall_desc = "未发现异常，运维状态良好"
        return {
            "action": "anomaly",
            "data": {
                "anomalies": anomalies,
                "total": len(anomalies),
                "overall_risk": overall_risk,
                "overall_description": overall_desc,
                "error_count": error_count,
                "warning_count": warning_count,
            },
        }

    elif req.action == "trace":
        traces = _trace_field(db, start, end, req.table_id, req.field_name, req.row_pk)
        return {"action": "trace", "data": {"traces": traces, "total": len(traces)}}

    else:
        raise HTTPException(400, f"Unknown action: {req.action}")
