"""Audit utility: record system operation logs."""

from typing import Optional
from sqlalchemy.orm import Session
from app.models import SystemOperationLog


def log_operation(
    db: Session,
    module: str,
    op_type: str,
    status: str,
    target_id: Optional[int] = None,
    target_code: Optional[str] = None,
    target_name: Optional[str] = None,
    message: Optional[str] = None,
    request_method: Optional[str] = None,
    request_path: Optional[str] = None,
    operator: str = "admin",
    operator_ip: Optional[str] = None,
):
    """Write a system_operation_log row."""
    log = SystemOperationLog(
        operation_type=op_type,
        operation_module=module,
        target_id=target_id,
        target_code=target_code,
        target_name=target_name,
        operation_status=status,
        operation_message=message,
        request_method=request_method,
        request_path=request_path,
        operator_user=operator,
        operator_ip=operator_ip,
    )
    db.add(log)
