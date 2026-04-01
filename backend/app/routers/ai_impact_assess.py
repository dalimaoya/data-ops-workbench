"""v3.0-P2: Writeback Impact Assessment — risk evaluation before writeback."""

from __future__ import annotations
import json
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import (
    TableConfig, FieldConfig, WritebackLog, UserAccount,
)
from app.utils.auth import get_current_user, require_role
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Impact Assessment"])


# ── Schemas ──

class ChangeItem(BaseModel):
    row_pk: Optional[str] = None
    field_name: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    change_type: Optional[str] = None  # update/insert/delete


class ImpactAssessRequest(BaseModel):
    table_id: int
    changes: List[ChangeItem]


class RiskItem(BaseModel):
    level: str  # high / medium / low
    type: str
    message: str
    suggestion: str
    detail: Optional[Dict[str, Any]] = None


# ── Assessment Logic ──

def _assess_impact(db: Session, table_id: int, changes: List[ChangeItem]) -> Dict[str, Any]:
    """Evaluate the risk of a writeback operation."""
    tc = db.query(TableConfig).filter(TableConfig.id == table_id, TableConfig.is_deleted == 0).first()
    if not tc:
        raise HTTPException(404, "纳管表不存在")

    fields = db.query(FieldConfig).filter(
        FieldConfig.table_config_id == table_id,
        FieldConfig.is_deleted == 0,
    ).all()
    field_map = {f.field_name: f for f in fields}

    risks: List[Dict[str, Any]] = []
    overall_level = "low"

    # 1. Sensitive field modification
    sensitive_changes = []
    high_sensitive_changes = []
    for c in changes:
        if c.field_name and c.field_name in field_map:
            f = field_map[c.field_name]
            level = getattr(f, 'sensitivity_level', 'normal') or 'normal'
            if level == "high_sensitive":
                high_sensitive_changes.append(c.field_name)
            elif level == "sensitive":
                sensitive_changes.append(c.field_name)

    if high_sensitive_changes:
        unique_fields = list(set(high_sensitive_changes))
        risks.append({
            "level": "high",
            "type": "sensitive_field",
            "message": f"修改了 {len(unique_fields)} 个高敏感字段：{', '.join(unique_fields[:5])}",
            "suggestion": "请确认高敏感字段的修改已获得相关审批",
            "detail": {"fields": unique_fields},
        })
        overall_level = "high"

    if sensitive_changes:
        unique_fields = list(set(sensitive_changes))
        risks.append({
            "level": "medium",
            "type": "sensitive_field",
            "message": f"修改了 {len(unique_fields)} 个敏感字段：{', '.join(unique_fields[:5])}",
            "suggestion": "建议确认敏感字段修改的必要性",
            "detail": {"fields": unique_fields},
        })
        if overall_level != "high":
            overall_level = "medium"

    # 2. Abnormal modification volume (> 3x historical average)
    total_change_rows = len(set(c.row_pk for c in changes if c.row_pk))
    hist_avg = _get_historical_avg_changes(db, table_id)
    if hist_avg > 0 and total_change_rows > hist_avg * 3:
        risks.append({
            "level": "medium",
            "type": "volume_anomaly",
            "message": f"修改行数 ({total_change_rows}) 超过历史平均 ({int(hist_avg)}) 的 3 倍",
            "suggestion": "请确认批量修改是否符合预期",
            "detail": {"current": total_change_rows, "avg": int(hist_avg), "ratio": round(total_change_rows / hist_avg, 1)},
        })
        if overall_level == "low":
            overall_level = "medium"

    # 3. First-time writeback (table never written back before)
    wb_count = db.query(func.count(WritebackLog.id)).filter(
        WritebackLog.table_config_id == table_id,
        WritebackLog.writeback_status == "success",
    ).scalar() or 0
    if wb_count == 0:
        risks.append({
            "level": "medium",
            "type": "first_writeback",
            "message": "该表从未被回写过，这是首次回写操作",
            "suggestion": "建议先用少量数据验证回写效果",
            "detail": {"historical_writebacks": 0},
        })
        if overall_level == "low":
            overall_level = "medium"

    # 4. Full-field modification (all editable fields in a row are modified)
    editable_fields = set(f.field_name for f in fields if f.is_editable)
    if editable_fields:
        rows_changes: Dict[str, set] = {}
        for c in changes:
            if c.row_pk and c.field_name and c.change_type == "update":
                rows_changes.setdefault(c.row_pk, set()).add(c.field_name)
        full_rows = [pk for pk, fs in rows_changes.items() if fs >= editable_fields and len(editable_fields) > 1]
        if full_rows:
            risks.append({
                "level": "medium",
                "type": "full_field_modification",
                "message": f"{len(full_rows)} 行的所有可编辑字段都被修改",
                "suggestion": "全字段修改可能是误操作导致，请仔细核对",
                "detail": {"affected_rows": len(full_rows)},
            })
            if overall_level == "low":
                overall_level = "medium"

    # If no risks found
    if not risks:
        risks.append({
            "level": "low",
            "type": "normal",
            "message": "未发现异常风险，可安全执行回写",
            "suggestion": "建议回写前确认差异数据无误",
        })

    return {
        "overall_level": overall_level,
        "risk_count": len([r for r in risks if r["level"] != "low" or r["type"] != "normal"]),
        "risks": risks,
        "summary": {
            "total_changes": len(changes),
            "change_rows": total_change_rows,
            "historical_writebacks": wb_count,
        },
    }


def _get_historical_avg_changes(db: Session, table_id: int) -> float:
    """Get average number of changed rows per writeback for a table."""
    results = db.query(WritebackLog.total_row_count).filter(
        WritebackLog.table_config_id == table_id,
        WritebackLog.writeback_status == "success",
    ).order_by(WritebackLog.id.desc()).limit(10).all()
    if not results:
        return 0
    total = sum(r[0] or 0 for r in results)
    return total / len(results)


# ── Endpoint ──

@router.post("/impact-assess")
def impact_assess(
    req: ImpactAssessRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Assess the impact/risk of a writeback operation."""
    data = _assess_impact(db, req.table_id, req.changes)
    return {"data": data}


# ── Field Sensitivity Config ──

class FieldSensitivityUpdate(BaseModel):
    field_id: int
    sensitivity_level: str  # normal / sensitive / high_sensitive
    sensitivity_note: Optional[str] = None


@router.put("/field-sensitivity")
def update_field_sensitivity(
    body: FieldSensitivityUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Update field sensitivity level (admin only)."""
    field = db.query(FieldConfig).filter(FieldConfig.id == body.field_id).first()
    if not field:
        raise HTTPException(404, "字段不存在")

    field.sensitivity_level = body.sensitivity_level
    field.sensitivity_note = body.sensitivity_note
    db.commit()
    return {"message": "字段敏感等级已更新"}


@router.get("/field-sensitivity/{table_id}")
def get_field_sensitivity(
    table_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Get field sensitivity config for a table."""
    fields = db.query(FieldConfig).filter(
        FieldConfig.table_config_id == table_id,
        FieldConfig.is_deleted == 0,
    ).order_by(FieldConfig.field_order_no).all()

    return {
        "fields": [
            {
                "id": f.id,
                "field_name": f.field_name,
                "field_alias": f.field_alias,
                "sensitivity_level": getattr(f, 'sensitivity_level', 'normal') or 'normal',
                "sensitivity_note": getattr(f, 'sensitivity_note', None),
                "is_editable": bool(f.is_editable),
            }
            for f in fields
        ]
    }
