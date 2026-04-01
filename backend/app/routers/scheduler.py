"""Scheduler API: CRUD for scheduled tasks + execution history."""

from __future__ import annotations

import json
import threading
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ScheduledTask, TaskExecutionLog, UserAccount, _now_bjt
from app.utils.auth import get_current_user, require_role
from app.utils.audit import log_operation
from app.i18n import t

router = APIRouter(prefix="/api/scheduler", tags=["定时任务"])


# ── Schemas ──

class ScheduleConfig(BaseModel):
    type: str = "cron"  # cron / interval
    hour: Optional[int] = None
    minute: Optional[int] = None
    second: Optional[int] = None
    day_of_week: Optional[str] = None
    day: Optional[str] = None
    month: Optional[str] = None
    minutes: Optional[int] = None
    hours: Optional[int] = None
    days: Optional[int] = None


class TaskCreate(BaseModel):
    name: str
    type: str  # health_check / platform_backup / data_export
    schedule: ScheduleConfig
    enabled: bool = True
    config: Dict[str, Any] = {}


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    schedule: Optional[ScheduleConfig] = None
    enabled: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None


# ── Endpoints ──

@router.get("/tasks")
def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """List all scheduled tasks."""
    q = db.query(ScheduledTask)
    total = q.count()
    rows = q.order_by(ScheduledTask.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for task in rows:
        schedule = {}
        if task.schedule_json:
            try:
                schedule = json.loads(task.schedule_json)
            except Exception:
                pass
        config = {}
        if task.config_json:
            try:
                config = json.loads(task.config_json)
            except Exception:
                pass

        items.append({
            "id": task.id,
            "name": task.name,
            "type": task.type,
            "schedule": schedule,
            "enabled": bool(task.enabled),
            "config": config,
            "last_run": task.last_run.isoformat() if task.last_run else None,
            "next_run": task.next_run.isoformat() if task.next_run else None,
            "created_at": task.created_at.isoformat() if task.created_at else None,
        })

    return {"total": total, "items": items}


@router.post("/tasks")
def create_task(
    body: TaskCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Create a new scheduled task."""
    valid_types = ("health_check", "platform_backup", "data_export")
    if body.type not in valid_types:
        raise HTTPException(400, t("scheduler.invalid_type"))

    schedule_dict = body.schedule.model_dump(exclude_none=True)
    config_dict = body.config or {}

    task = ScheduledTask(
        name=body.name,
        type=body.type,
        schedule_json=json.dumps(schedule_dict, ensure_ascii=False),
        enabled=1 if body.enabled else 0,
        config_json=json.dumps(config_dict, ensure_ascii=False) if config_dict else None,
    )
    db.add(task)
    db.flush()

    log_operation(db, "定时任务", "创建任务", "success",
                  target_id=task.id, target_name=task.name,
                  message=f"创建定时任务: {task.name} ({task.type})",
                  operator=user.username)
    db.commit()

    # Add to scheduler and retrieve next_run_time
    if task.enabled:
        try:
            from app.scheduler.engine import add_task_to_scheduler, get_scheduler
            add_task_to_scheduler(task)
            # Fetch next_run_time from APScheduler and persist
            job = get_scheduler().get_job(f"task_{task.id}")
            if job and job.next_run_time:
                task.next_run = job.next_run_time
                db.commit()
                db.refresh(task)
        except Exception:
            pass

    return {
        "id": task.id,
        "message": t("scheduler.created"),
        "next_run": task.next_run.isoformat() if task.next_run else None,
    }


@router.put("/tasks/{task_id}")
def update_task(
    task_id: int,
    body: TaskUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Update a scheduled task."""
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(404, t("scheduler.not_found"))

    if body.name is not None:
        task.name = body.name
    if body.type is not None:
        valid_types = ("health_check", "platform_backup", "data_export")
        if body.type not in valid_types:
            raise HTTPException(400, t("scheduler.invalid_type"))
        task.type = body.type
    if body.schedule is not None:
        task.schedule_json = json.dumps(body.schedule.model_dump(exclude_none=True), ensure_ascii=False)
    if body.enabled is not None:
        task.enabled = 1 if body.enabled else 0
    if body.config is not None:
        task.config_json = json.dumps(body.config, ensure_ascii=False) if body.config else None

    log_operation(db, "定时任务", "编辑任务", "success",
                  target_id=task.id, target_name=task.name,
                  message=f"编辑定时任务: {task.name}",
                  operator=user.username)
    db.commit()

    # Update scheduler
    try:
        from app.scheduler.engine import add_task_to_scheduler, remove_task_from_scheduler
        if task.enabled:
            add_task_to_scheduler(task)
        else:
            remove_task_from_scheduler(task.id)
    except Exception:
        pass

    return {"id": task.id, "message": t("scheduler.updated")}


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Delete a scheduled task."""
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(404, t("scheduler.not_found"))

    task_name = task.name

    # Remove from scheduler
    try:
        from app.scheduler.engine import remove_task_from_scheduler
        remove_task_from_scheduler(task_id)
    except Exception:
        pass

    # Delete execution logs
    db.query(TaskExecutionLog).filter(TaskExecutionLog.task_id == task_id).delete()
    db.delete(task)

    log_operation(db, "定时任务", "删除任务", "success",
                  target_id=task_id, target_name=task_name,
                  message=f"删除定时任务: {task_name}",
                  operator=user.username)
    db.commit()

    return {"message": t("scheduler.deleted")}


@router.post("/tasks/{task_id}/run")
def run_task_now(
    task_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Execute a task immediately."""
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(404, t("scheduler.not_found"))

    log_operation(db, "定时任务", "立即执行", "success",
                  target_id=task.id, target_name=task.name,
                  message=f"手动执行定时任务: {task.name}",
                  operator=user.username)
    db.commit()

    # Run in background thread
    from app.scheduler.engine import _execute_task
    t_thread = threading.Thread(target=_execute_task, args=[task_id], daemon=True)
    t_thread.start()

    return {"message": t("scheduler.run_started")}


@router.get("/execution-logs")
def get_all_execution_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Get all execution logs across all tasks."""
    q = db.query(TaskExecutionLog)
    total = q.count()
    rows = q.order_by(TaskExecutionLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Build task name map
    task_ids = list(set(log.task_id for log in rows))
    tasks = db.query(ScheduledTask).filter(ScheduledTask.id.in_(task_ids)).all() if task_ids else []
    task_map = {t.id: t.name for t in tasks}

    items = []
    for log in rows:
        items.append({
            "id": log.id,
            "task_id": log.task_id,
            "task_name": task_map.get(log.task_id, f"task-{log.task_id}"),
            "started_at": log.started_at.isoformat() if log.started_at else None,
            "finished_at": log.finished_at.isoformat() if log.finished_at else None,
            "status": log.status,
            "result_summary": log.result_summary,
            "error_message": log.error_message,
        })

    return {"total": total, "items": items}


@router.get("/tasks/{task_id}/history")
def get_task_history(
    task_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Get execution history for a task."""
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(404, t("scheduler.not_found"))

    q = db.query(TaskExecutionLog).filter(TaskExecutionLog.task_id == task_id)
    total = q.count()
    rows = q.order_by(TaskExecutionLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for log in rows:
        items.append({
            "id": log.id,
            "task_id": log.task_id,
            "started_at": log.started_at.isoformat() if log.started_at else None,
            "finished_at": log.finished_at.isoformat() if log.finished_at else None,
            "status": log.status,
            "result_summary": log.result_summary,
            "error_message": log.error_message,
        })

    return {"total": total, "items": items, "task_name": task.name}
