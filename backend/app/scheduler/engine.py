"""APScheduler engine: initialize, load tasks, execute."""

from __future__ import annotations

import logging
import traceback
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import ScheduledTask, TaskExecutionLog, _now_bjt

logger = logging.getLogger("scheduler")

_scheduler: Optional[BackgroundScheduler] = None


def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    return _scheduler


def _build_trigger(schedule: dict):
    """Build APScheduler trigger from schedule dict."""
    stype = schedule.get("type", "cron")
    if stype == "interval":
        kwargs = {}
        if "minutes" in schedule:
            kwargs["minutes"] = int(schedule["minutes"])
        if "hours" in schedule:
            kwargs["hours"] = int(schedule["hours"])
        if "days" in schedule:
            kwargs["days"] = int(schedule["days"])
        if not kwargs:
            kwargs["hours"] = 1  # default
        return IntervalTrigger(**kwargs)
    else:
        # cron
        kwargs = {}
        for field in ("year", "month", "day", "week", "day_of_week", "hour", "minute", "second"):
            if field in schedule:
                kwargs[field] = schedule[field]
        if not kwargs:
            kwargs = {"hour": 6, "minute": 0}
        return CronTrigger(**kwargs)


def _execute_task(task_id: int):
    """Execute a scheduled task by type."""
    db: Session = SessionLocal()
    started_at = _now_bjt()
    log_entry = TaskExecutionLog(
        task_id=task_id,
        started_at=started_at,
        status="running",
    )
    try:
        task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
        if not task:
            return

        db.add(log_entry)
        db.flush()

        result_summary = ""
        if task.type == "health_check":
            result_summary = _run_health_check(db, task)
        elif task.type == "platform_backup":
            result_summary = _run_platform_backup(db, task)
        elif task.type == "data_export":
            result_summary = _run_data_export(db, task)
        else:
            result_summary = f"Unknown task type: {task.type}"

        log_entry.status = "success"
        log_entry.result_summary = result_summary[:1000] if result_summary else "OK"
        log_entry.finished_at = _now_bjt()

        task.last_run = _now_bjt()
        # Update next_run from scheduler job (independent try-except to avoid
        # marking the task as failed when next_run_time is unavailable, e.g.
        # manual trigger scenario)
        try:
            scheduler = get_scheduler()
            job = scheduler.get_job(f"task_{task_id}")
            if job and job.next_run_time:
                task.next_run = job.next_run_time
        except Exception:
            logger.debug("Could not update next_run for task %d", task_id)

        db.commit()
    except Exception as e:
        logger.error("Task %d failed: %s", task_id, traceback.format_exc())
        log_entry.status = "failed"
        log_entry.error_message = str(e)[:1000]
        log_entry.finished_at = _now_bjt()
        try:
            db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def _run_health_check(db: Session, task: ScheduledTask) -> str:
    """Execute health check task by importing and calling the health check logic."""
    try:
        import uuid
        from app.models import DatasourceConfig, TableConfig, HealthCheckResult
        from app.utils.crypto import decrypt_password
        from app.utils.remote_db import _connect, compute_structure_hash

        batch_no = "HC_SCH_" + _now_bjt().strftime("%Y%m%d%H%M%S") + "_" + uuid.uuid4().hex[:4].upper()
        datasources = db.query(DatasourceConfig).filter(
            DatasourceConfig.is_deleted == 0,
            DatasourceConfig.status != "disabled",
        ).all()

        ok_count = 0
        err_count = 0
        for ds in datasources:
            try:
                pwd = decrypt_password(ds.password_encrypted)
                import time
                t0 = time.time()
                conn = _connect(ds.db_type, ds.host, ds.port, ds.username, pwd,
                                ds.database_name, ds.schema_name, ds.charset, ds.connect_timeout_seconds or 10)
                elapsed = int((time.time() - t0) * 1000)
                conn.close()
                db.add(HealthCheckResult(
                    check_batch_no=batch_no, datasource_id=ds.id,
                    check_item="connection", check_status="ok",
                    check_message=f"Connected in {elapsed}ms",
                    response_time_ms=elapsed, operator_user="scheduler",
                ))
                ok_count += 1
            except Exception as e:
                db.add(HealthCheckResult(
                    check_batch_no=batch_no, datasource_id=ds.id,
                    check_item="connection", check_status="error",
                    check_message=str(e)[:500], operator_user="scheduler",
                ))
                err_count += 1
        db.commit()
        return f"Health check done: {ok_count} ok, {err_count} errors (batch {batch_no})"
    except Exception as e:
        return f"Health check error: {str(e)}"


def _run_platform_backup(db: Session, task: ScheduledTask) -> str:
    """Execute platform backup task."""
    try:
        import os
        import json as json_mod
        import zipfile
        from app.database import DATA_DIR
        from app.models import (
            DatasourceConfig, TableConfig, FieldConfig,
            UserAccount, SystemSetting, AIConfig,
        )

        backup_dir = os.path.join(DATA_DIR, "platform_backups")
        os.makedirs(backup_dir, exist_ok=True)
        ts = _now_bjt().strftime("%Y%m%d_%H%M%S")
        file_name = f"scheduled_backup_{ts}.zip"
        file_path = os.path.join(backup_dir, file_name)

        data = {
            "meta": {"version": "3.1", "created_at": _now_bjt().isoformat(), "operator": "scheduler"},
            "datasources": [{"id": d.id, "name": d.datasource_name, "db_type": d.db_type}
                            for d in db.query(DatasourceConfig).filter(DatasourceConfig.is_deleted == 0).all()],
            "tables": [{"id": t.id, "name": t.table_name} for t in db.query(TableConfig).filter(TableConfig.is_deleted == 0).all()],
        }

        with zipfile.ZipFile(file_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("backup_meta.json", json_mod.dumps(data, ensure_ascii=False, indent=2))
            # Also backup the SQLite DB if exists
            db_path = os.path.join(DATA_DIR, "data_ops.db")
            if os.path.isfile(db_path):
                zf.write(db_path, "data_ops.db")

        return f"Backup created: {file_name}"
    except Exception as e:
        return f"Backup error: {str(e)}"


def _run_data_export(db: Session, task: ScheduledTask) -> str:
    """Execute data export task."""
    import json
    config = {}
    if task.config_json:
        try:
            config = json.loads(task.config_json)
        except Exception:
            pass
    table_config_id = config.get("table_config_id")
    if not table_config_id:
        return "No table_config_id in task config"

    try:
        from app.routers.data_maintenance import _run_async_export
        import uuid
        task_id_str = uuid.uuid4().hex[:16].upper()
        from app.models import ExportTask
        export_task = ExportTask(
            task_id=task_id_str,
            table_config_id=table_config_id,
            datasource_id=config.get("datasource_id", 0),
            export_type="all",
            status="processing",
            operator_user="scheduler",
        )
        db.add(export_task)
        db.commit()

        import threading
        t = threading.Thread(
            target=_run_async_export,
            args=(task_id_str, table_config_id, "all", None, None, "scheduler"),
            daemon=True,
        )
        t.start()
        return f"Export task {task_id_str} created for table {table_config_id}"
    except Exception as e:
        return f"Export error: {str(e)}"


def add_task_to_scheduler(task: ScheduledTask):
    """Add or replace a task in the APScheduler."""
    import json
    scheduler = get_scheduler()
    job_id = f"task_{task.id}"

    # Remove existing job if any
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass

    if not task.enabled:
        return

    schedule = {}
    if task.schedule_json:
        try:
            schedule = json.loads(task.schedule_json)
        except Exception:
            schedule = {"type": "cron", "hour": 6, "minute": 0}

    trigger = _build_trigger(schedule)
    scheduler.add_job(
        _execute_task,
        trigger=trigger,
        args=[task.id],
        id=job_id,
        replace_existing=True,
        misfire_grace_time=300,
    )

    # Update next_run
    job = scheduler.get_job(job_id)
    if job and job.next_run_time:
        db = SessionLocal()
        try:
            t = db.query(ScheduledTask).filter(ScheduledTask.id == task.id).first()
            if t:
                t.next_run = job.next_run_time
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()


def remove_task_from_scheduler(task_id: int):
    """Remove a task from APScheduler."""
    scheduler = get_scheduler()
    try:
        scheduler.remove_job(f"task_{task_id}")
    except Exception:
        pass


def init_scheduler():
    """Initialize APScheduler and load all enabled tasks."""
    scheduler = get_scheduler()
    if scheduler.running:
        return

    db = SessionLocal()
    try:
        tasks = db.query(ScheduledTask).filter(ScheduledTask.enabled == 1).all()
        for task in tasks:
            try:
                add_task_to_scheduler(task)
            except Exception as e:
                logger.error("Failed to load task %d: %s", task.id, str(e))
    finally:
        db.close()

    scheduler.start()
    logger.info("Scheduler started with %d jobs", len(scheduler.get_jobs()))


def shutdown_scheduler():
    """Shut down the scheduler."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        _scheduler = None
