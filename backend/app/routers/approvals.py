"""Approval workflow endpoints (v2.2)."""

from __future__ import annotations
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    ApprovalRequest, SystemSetting, ImportTaskLog, TableConfig,
    DatasourceConfig, UserAccount, _now_bjt,
)
from app.utils.auth import get_current_user, require_role
from app.utils.audit import log_operation
from app.i18n import t

router = APIRouter(prefix="/api", tags=["审批流"])


# ── Settings ──

@router.get("/settings/approval-enabled")
def get_approval_enabled(
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    row = db.query(SystemSetting).filter(
        SystemSetting.setting_key == "approval_enabled"
    ).first()
    enabled = row.setting_value == "true" if row else False
    return {"approval_enabled": enabled}


@router.put("/settings/approval-enabled")
def set_approval_enabled(
    body: dict,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    enabled = body.get("approval_enabled", False)
    row = db.query(SystemSetting).filter(
        SystemSetting.setting_key == "approval_enabled"
    ).first()
    if row:
        row.setting_value = "true" if enabled else "false"
        row.updated_at = _now_bjt()
    else:
        db.add(SystemSetting(
            setting_key="approval_enabled",
            setting_value="true" if enabled else "false",
        ))
    log_operation(
        db, "系统设置", "审批流开关", "success",
        message="审批流开关设置为: %s" % ("启用" if enabled else "关闭"),
        operator=user.username,
    )
    db.commit()
    return {"approval_enabled": enabled}


# ── Helpers ──

def is_approval_enabled(db: Session) -> bool:
    row = db.query(SystemSetting).filter(
        SystemSetting.setting_key == "approval_enabled"
    ).first()
    return row is not None and row.setting_value == "true"


def needs_approval(db: Session, user: UserAccount) -> bool:
    """Check if this user's operations need approval."""
    if user.role == "admin":
        return False
    return is_approval_enabled(db)


# ── Schemas ──

class ApprovalCreateRequest(BaseModel):
    import_task_id: Optional[int] = None
    table_config_id: int
    request_type: str  # writeback/delete/batch_insert/inline_update/inline_insert
    request_data_json: Optional[str] = None


class ApprovalRejectRequest(BaseModel):
    reject_reason: Optional[str] = None


# ── CRUD ──

@router.post("/approvals")
def create_approval(
    body: ApprovalCreateRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    tc = db.query(TableConfig).filter(
        TableConfig.id == body.table_config_id, TableConfig.is_deleted == 0
    ).first()
    if not tc:
        raise HTTPException(404, t("table_config.not_found"))

    approval = ApprovalRequest(
        import_task_id=body.import_task_id,
        table_config_id=body.table_config_id,
        request_type=body.request_type,
        request_data_json=body.request_data_json,
        requested_by=user.username,
        request_time=_now_bjt(),
        status="pending",
        structure_hash_at_request=tc.structure_version_hash,
    )
    db.add(approval)
    db.flush()
    log_operation(
        db, "审批流", "提交审批", "success",
        target_id=approval.id,
        target_name=tc.table_name,
        message="用户 %s 提交 %s 审批" % (user.username, body.request_type),
        operator=user.username,
    )
    # v2.3: notify admins
    from app.utils.notifications import notify_admins
    notify_admins(
        db,
        "新审批请求",
        "用户 %s 提交了「%s」的 %s 审批请求" % (user.username, tc.table_name, body.request_type),
        ntype="info",
        related_url="/approval-center",
    )
    db.commit()
    db.refresh(approval)
    return {
        "id": approval.id,
        "status": "pending",
        "message": t("approval.submitted"),
    }


@router.get("/approvals")
def list_approvals(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    q = db.query(ApprovalRequest)
    # non-admin users only see their own
    if user.role != "admin":
        q = q.filter(ApprovalRequest.requested_by == user.username)
    if status:
        q = q.filter(ApprovalRequest.status == status)
    total = q.count()
    rows = q.order_by(ApprovalRequest.id.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    items = []
    for r in rows:
        tc = db.query(TableConfig).filter(TableConfig.id == r.table_config_id).first()
        ds = None
        if tc:
            ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == tc.datasource_id).first()
        items.append({
            "id": r.id,
            "import_task_id": r.import_task_id,
            "table_config_id": r.table_config_id,
            "table_name": tc.table_name if tc else None,
            "table_alias": tc.table_alias if tc else None,
            "datasource_name": ds.datasource_name if ds else None,
            "request_type": r.request_type,
            "requested_by": r.requested_by,
            "request_time": r.request_time.isoformat() if r.request_time else None,
            "status": r.status,
            "approved_by": r.approved_by,
            "approve_time": r.approve_time.isoformat() if r.approve_time else None,
            "reject_reason": r.reject_reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": total, "items": items}


@router.get("/approvals/{approval_id}")
def get_approval_detail(
    approval_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    approval = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_id).first()
    if not approval:
        raise HTTPException(404, t("approval.not_found"))
    tc = db.query(TableConfig).filter(TableConfig.id == approval.table_config_id).first()
    ds = None
    if tc:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == tc.datasource_id).first()

    # Parse request_data_json for diff preview if writeback type
    diff_preview = None
    if approval.request_type == "writeback" and approval.import_task_id:
        import os
        from app.database import DATA_DIR
        diff_file = os.path.join(DATA_DIR, "uploads", "diff_%d.json" % approval.import_task_id)
        if os.path.isfile(diff_file):
            try:
                with open(diff_file, "r", encoding="utf-8") as f:
                    diff_preview = json.load(f)
            except Exception:
                pass

    return {
        "id": approval.id,
        "import_task_id": approval.import_task_id,
        "table_config_id": approval.table_config_id,
        "table_name": tc.table_name if tc else None,
        "table_alias": tc.table_alias if tc else None,
        "datasource_name": ds.datasource_name if ds else None,
        "request_type": approval.request_type,
        "request_data_json": approval.request_data_json,
        "requested_by": approval.requested_by,
        "request_time": approval.request_time.isoformat() if approval.request_time else None,
        "status": approval.status,
        "approved_by": approval.approved_by,
        "approve_time": approval.approve_time.isoformat() if approval.approve_time else None,
        "reject_reason": approval.reject_reason,
        "structure_hash_at_request": approval.structure_hash_at_request,
        "diff_preview": diff_preview,
    }


@router.put("/approvals/{approval_id}/approve")
def approve_request(
    approval_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    approval = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_id).first()
    if not approval:
        raise HTTPException(404, t("approval.not_found"))
    if approval.status != "pending":
        raise HTTPException(400, t("approval.already_processed"))

    # Check structure hash hasn't changed
    tc = db.query(TableConfig).filter(TableConfig.id == approval.table_config_id).first()
    if tc and approval.structure_hash_at_request:
        if tc.structure_version_hash != approval.structure_hash_at_request:
            raise HTTPException(
                400,
                t("approval.structure_changed"),
            )

    approval.status = "approved"
    approval.approved_by = user.username
    approval.approve_time = _now_bjt()

    log_operation(
        db, "审批流", "审批通过", "success",
        target_id=approval.id,
        target_name=tc.table_name if tc else None,
        message="管理员 %s 通过了 %s 的 %s 审批" % (
            user.username, approval.requested_by, approval.request_type
        ),
        operator=user.username,
    )
    # v2.3: notify requester
    from app.utils.notifications import notify_user_by_username
    notify_user_by_username(
        db, approval.requested_by,
        "审批已通过",
        "您对表「%s」的 %s 审批已被管理员 %s 通过" % (
            tc.table_name if tc else "未知", approval.request_type, user.username),
        ntype="success",
        related_url="/approval-center",
    )
    db.commit()

    # Execute the actual operation
    result = _execute_approved_operation(approval, db, user)
    return {
        "id": approval.id,
        "status": "approved",
        "message": t("approval.approved"),
        "execution_result": result,
    }


@router.put("/approvals/{approval_id}/reject")
def reject_request(
    approval_id: int,
    body: ApprovalRejectRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    approval = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_id).first()
    if not approval:
        raise HTTPException(404, t("approval.not_found"))
    if approval.status != "pending":
        raise HTTPException(400, t("approval.already_processed"))

    approval.status = "rejected"
    approval.approved_by = user.username
    approval.approve_time = _now_bjt()
    approval.reject_reason = body.reject_reason or ""

    tc = db.query(TableConfig).filter(TableConfig.id == approval.table_config_id).first()
    log_operation(
        db, "审批流", "审批拒绝", "success",
        target_id=approval.id,
        target_name=tc.table_name if tc else None,
        message="管理员 %s 拒绝了 %s 的 %s 审批，原因：%s" % (
            user.username, approval.requested_by, approval.request_type,
            body.reject_reason or "无",
        ),
        operator=user.username,
    )
    # v2.3: notify requester
    from app.utils.notifications import notify_user_by_username
    notify_user_by_username(
        db, approval.requested_by,
        "审批被拒绝",
        "您对表「%s」的 %s 审批已被拒绝，原因：%s" % (
            tc.table_name if tc else "未知", approval.request_type, body.reject_reason or "无"),
        ntype="error",
        related_url="/approval-center",
    )
    db.commit()
    return {
        "id": approval.id,
        "status": "rejected",
        "message": t("approval.rejected"),
    }


def _execute_approved_operation(approval: ApprovalRequest, db: Session, admin_user: UserAccount):
    """Execute the operation after approval is granted.
    We import and call the actual operation functions from data_maintenance router.
    """
    from app.routers.data_maintenance import (
        writeback, delete_rows, batch_insert, inline_update, inline_insert,
        DeleteRowsRequest, BatchInsertRequest, InlineUpdateRequest, InlineInsertRequest,
        InlineChange,
    )

    # Create a mock user object with the original requester's info
    requester = db.query(UserAccount).filter(
        UserAccount.username == approval.requested_by
    ).first()
    if not requester:
        return {"error": t("user.not_found")}

    try:
        if approval.request_type == "writeback" and approval.import_task_id:
            result = writeback(
                task_id=approval.import_task_id,
                db=db,
                user=admin_user,  # execute as admin to bypass approval check
            )
            return result

        if approval.request_data_json:
            data = json.loads(approval.request_data_json)
        else:
            data = {}

        if approval.request_type == "delete":
            body = DeleteRowsRequest(pk_values=data.get("pk_values", []))
            result = delete_rows(
                table_config_id=approval.table_config_id,
                body=body, db=db, user=admin_user,
            )
            return result

        elif approval.request_type == "batch_insert":
            body = BatchInsertRequest(rows=data.get("rows", []))
            result = batch_insert(
                table_config_id=approval.table_config_id,
                body=body, db=db, user=admin_user,
            )
            return result

        elif approval.request_type == "inline_update":
            changes = []
            for c in data.get("changes", []):
                changes.append(InlineChange(
                    pk_values=c.get("pk_values", {}),
                    updates=c.get("updates", {}),
                ))
            body = InlineUpdateRequest(changes=changes)
            result = inline_update(
                table_config_id=approval.table_config_id,
                body=body, db=db, user=admin_user,
            )
            return result

        elif approval.request_type == "inline_insert":
            from app.routers.data_maintenance import InlineInsertRequest as IIR
            body = IIR(row_data=data.get("row_data", {}))
            result = inline_insert(
                table_config_id=approval.table_config_id,
                body=body, db=db, user=admin_user,
            )
            return result

        return {"message": t("approval.unknown_type", type=approval.request_type)}

    except HTTPException as e:
        return {"error": e.detail}
    except Exception as e:
        return {"error": str(e)}
