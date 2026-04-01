"""Platform database models - 11 core tables (incl. field_change_log for v2.0) + ai_config for v3.0 + health_check + field_sensitivity for v3.0-P2 + scheduler for v3.1."""

from datetime import datetime, timezone, timedelta
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, SmallInteger, Float, Boolean,
    UniqueConstraint,
)
from app.database import Base

# 北京时间 UTC+8
_BJT = timezone(timedelta(hours=8))


def _now_bjt() -> datetime:
    return datetime.now(_BJT)


# ── Mixin for audit fields ──
class AuditMixin:
    created_by = Column(String(64), nullable=False, default="system")
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    updated_by = Column(String(64), nullable=False, default="system")
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)
    is_deleted = Column(SmallInteger, nullable=False, default=0)


# ── 1. datasource_config ──
class DatasourceConfig(AuditMixin, Base):
    __tablename__ = "datasource_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    datasource_code = Column(String(64), unique=True, nullable=False)
    datasource_name = Column(String(128), nullable=False)
    db_type = Column(String(32), nullable=False, index=True)  # mysql/postgresql/sqlserver
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False)
    database_name = Column(String(128), nullable=True)
    schema_name = Column(String(128), nullable=True)
    username = Column(String(128), nullable=False)
    password_encrypted = Column(Text, nullable=False)
    charset = Column(String(32), nullable=True, default="utf8")
    connect_timeout_seconds = Column(Integer, nullable=True, default=10)
    status = Column(String(32), nullable=False, default="enabled", index=True)
    last_test_status = Column(String(32), nullable=True)
    last_test_message = Column(String(1000), nullable=True)
    last_test_at = Column(DateTime, nullable=True)
    remark = Column(String(500), nullable=True)


# ── 2. table_config ──
class TableConfig(AuditMixin, Base):
    __tablename__ = "table_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    table_config_code = Column(String(64), unique=True, nullable=False)
    datasource_id = Column(Integer, nullable=False)
    db_name = Column(String(128), nullable=True)
    schema_name = Column(String(128), nullable=True)
    table_name = Column(String(128), nullable=False)
    table_alias = Column(String(128), nullable=True)
    table_comment = Column(String(500), nullable=True)
    config_version = Column(Integer, nullable=False, default=1)
    structure_version_hash = Column(String(128), nullable=True)
    primary_key_fields = Column(String(500), nullable=False)
    unique_key_fields = Column(String(500), nullable=True)
    allow_export_current = Column(SmallInteger, nullable=False, default=1)
    allow_export_all = Column(SmallInteger, nullable=False, default=1)
    allow_import_writeback = Column(SmallInteger, nullable=False, default=1)
    allow_insert_rows = Column(SmallInteger, nullable=False, default=1)
    allow_delete_rows = Column(SmallInteger, nullable=False, default=1)
    template_reserved_blank_rows = Column(Integer, nullable=False, default=200)
    backup_keep_count = Column(Integer, nullable=False, default=3)
    strict_template_version = Column(SmallInteger, nullable=False, default=1)
    strict_field_order = Column(SmallInteger, nullable=False, default=1)
    status = Column(String(32), nullable=False, default="enabled")
    structure_check_status = Column(String(32), nullable=True)
    last_structure_check_at = Column(DateTime, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    remark = Column(String(500), nullable=True)


# ── 3. field_config ──
class FieldConfig(AuditMixin, Base):
    __tablename__ = "field_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    table_config_id = Column(Integer, nullable=False)
    field_name = Column(String(128), nullable=False)
    field_alias = Column(String(128), nullable=True)
    db_data_type = Column(String(64), nullable=False)
    field_order_no = Column(Integer, nullable=False)
    sample_value = Column(String(1000), nullable=True)
    is_displayed = Column(SmallInteger, nullable=False, default=1)
    is_editable = Column(SmallInteger, nullable=False, default=1)
    is_required = Column(SmallInteger, nullable=False, default=0)
    is_primary_key = Column(SmallInteger, nullable=False, default=0)
    is_unique_key = Column(SmallInteger, nullable=False, default=0)
    is_system_field = Column(SmallInteger, nullable=False, default=0)
    include_in_export = Column(SmallInteger, nullable=False, default=1)
    include_in_import = Column(SmallInteger, nullable=False, default=1)
    max_length = Column(Integer, nullable=True)
    enum_options_json = Column(Text, nullable=True)
    validation_rule_json = Column(Text, nullable=True)
    default_display_type = Column(String(32), nullable=True, default="text")
    editable_roles = Column(String(255), nullable=True)  # v2.4: comma-separated roles, e.g. "admin,operator"
    sensitivity_level = Column(String(32), nullable=True, default="normal")  # v3.0-P2: normal/sensitive/high_sensitive
    sensitivity_note = Column(String(500), nullable=True)  # v3.0-P2: admin description of impact
    remark = Column(String(500), nullable=True)


# ── 4. template_export_log ──
class TemplateExportLog(Base):
    __tablename__ = "template_export_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    export_batch_no = Column(String(64), unique=True, nullable=False)
    table_config_id = Column(Integer, nullable=False)
    datasource_id = Column(Integer, nullable=False)
    export_type = Column(String(32), nullable=False)
    row_count = Column(Integer, nullable=False, default=0)
    field_count = Column(Integer, nullable=False, default=0)
    template_version = Column(Integer, nullable=False)
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    export_filters_json = Column(Text, nullable=True)
    operator_user = Column(String(64), nullable=False)
    operator_ip = Column(String(64), nullable=True)
    remark = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 5. import_task_log ──
class ImportTaskLog(Base):
    __tablename__ = "import_task_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_batch_no = Column(String(64), unique=True, nullable=False)
    table_config_id = Column(Integer, nullable=False)
    datasource_id = Column(Integer, nullable=False)
    related_export_batch_no = Column(String(64), nullable=True)
    import_file_name = Column(String(255), nullable=False)
    import_file_path = Column(String(500), nullable=True)
    template_version = Column(Integer, nullable=True)
    total_row_count = Column(Integer, nullable=False, default=0)
    passed_row_count = Column(Integer, nullable=False, default=0)
    warning_row_count = Column(Integer, nullable=False, default=0)
    failed_row_count = Column(Integer, nullable=False, default=0)
    diff_row_count = Column(Integer, nullable=False, default=0)
    new_row_count = Column(Integer, nullable=False, default=0)
    validation_status = Column(String(32), nullable=False, default="waiting")
    validation_message = Column(String(1000), nullable=True)
    error_detail_json = Column(Text, nullable=True)
    import_status = Column(String(32), nullable=False, default="uploaded")
    operator_user = Column(String(64), nullable=False)
    operator_ip = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


# ── 6. writeback_log ──
class WritebackLog(Base):
    __tablename__ = "writeback_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    writeback_batch_no = Column(String(64), unique=True, nullable=False)
    import_task_id = Column(Integer, nullable=True)  # nullable for multi-table AI writeback
    table_config_id = Column(Integer, nullable=False)
    datasource_id = Column(Integer, nullable=False)
    backup_version_no = Column(String(64), nullable=True)
    total_row_count = Column(Integer, nullable=False, default=0)
    success_row_count = Column(Integer, nullable=False, default=0)
    failed_row_count = Column(Integer, nullable=False, default=0)
    skipped_row_count = Column(Integer, nullable=False, default=0)
    inserted_row_count = Column(Integer, nullable=False, default=0)
    updated_row_count = Column(Integer, nullable=False, default=0)
    deleted_row_count = Column(Integer, nullable=False, default=0)
    writeback_status = Column(String(32), nullable=False, default="running")
    writeback_message = Column(String(1000), nullable=True)
    failed_detail_json = Column(Text, nullable=True)
    operator_user = Column(String(64), nullable=False)
    operator_ip = Column(String(64), nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 7. table_backup_version ──
class TableBackupVersion(Base):
    __tablename__ = "table_backup_version"

    id = Column(Integer, primary_key=True, autoincrement=True)
    backup_version_no = Column(String(64), unique=True, nullable=False)
    table_config_id = Column(Integer, nullable=False)
    datasource_id = Column(Integer, nullable=False)
    backup_table_name = Column(String(255), nullable=False)
    source_table_name = Column(String(255), nullable=False)
    source_db_name = Column(String(128), nullable=True)
    source_schema_name = Column(String(128), nullable=True)
    trigger_type = Column(String(32), nullable=False)
    related_writeback_batch_no = Column(String(64), nullable=True)
    record_count = Column(Integer, nullable=True)
    storage_status = Column(String(32), nullable=False, default="valid")
    can_rollback = Column(SmallInteger, nullable=False, default=1)
    backup_started_at = Column(DateTime, nullable=True)
    backup_finished_at = Column(DateTime, nullable=True)
    operator_user = Column(String(64), nullable=False)
    remark = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 8. user_account ──
class UserAccount(Base):
    __tablename__ = "user_account"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(32), nullable=False, default="operator")  # superadmin / admin / operator / viewer
    display_name = Column(String(128), nullable=True)
    status = Column(String(32), nullable=False, default="enabled")
    last_login_at = Column(DateTime, nullable=True)  # v3.6: track last login time
    wechat_unionid = Column(String(128), nullable=True)  # v5.0: bind first WeChat scan to admin
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


# ── 9. system_operation_log ──
class SystemOperationLog(Base):
    __tablename__ = "system_operation_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    operation_type = Column(String(64), nullable=False)
    operation_module = Column(String(64), nullable=False)
    target_id = Column(Integer, nullable=True)
    target_code = Column(String(64), nullable=True)
    target_name = Column(String(255), nullable=True)
    operation_status = Column(String(32), nullable=False)
    operation_message = Column(String(1000), nullable=True)
    request_method = Column(String(16), nullable=True)
    request_path = Column(String(255), nullable=True)
    request_params_json = Column(Text, nullable=True)
    operator_user = Column(String(64), nullable=False)
    operator_ip = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 10. user_datasource_permission (v2.2) ──
class UserDatasourcePermission(Base):
    __tablename__ = "user_datasource_permission"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    datasource_id = Column(Integer, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 10b. user_plugin_permission (v5.1) ──
class UserPluginPermission(Base):
    __tablename__ = "user_plugin_permission"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    plugin_name = Column(String(100), nullable=False)
    granted_at = Column(DateTime, nullable=False, default=_now_bjt)

    __table_args__ = (
        UniqueConstraint("user_id", "plugin_name", name="uq_user_plugin"),
    )


# ── 11. approval_request (v2.2) ──
class ApprovalRequest(Base):
    __tablename__ = "approval_request"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_task_id = Column(Integer, nullable=True)
    table_config_id = Column(Integer, nullable=False)
    request_type = Column(String(32), nullable=False)  # writeback/delete/batch_insert/inline_update/inline_insert
    request_data_json = Column(Text, nullable=True)  # serialized request body for replay
    requested_by = Column(String(64), nullable=False)
    request_time = Column(DateTime, nullable=False, default=_now_bjt)
    status = Column(String(32), nullable=False, default="pending")  # pending/approved/rejected
    approved_by = Column(String(64), nullable=True)
    approve_time = Column(DateTime, nullable=True)
    reject_reason = Column(String(1000), nullable=True)
    structure_hash_at_request = Column(String(128), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 12. system_setting (v2.2) ──
class SystemSetting(Base):
    __tablename__ = "system_setting"

    id = Column(Integer, primary_key=True, autoincrement=True)
    setting_key = Column(String(128), unique=True, nullable=False)
    setting_value = Column(String(1000), nullable=False)
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


# ── 13. export_task (v2.3) ──
class ExportTask(Base):
    __tablename__ = "export_task"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(64), unique=True, nullable=False)
    table_config_id = Column(Integer, nullable=False)
    datasource_id = Column(Integer, nullable=False)
    export_type = Column(String(32), nullable=False, default="all")
    export_filters_json = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="processing")  # processing/completed/failed
    row_count = Column(Integer, nullable=True)
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    error_message = Column(String(1000), nullable=True)
    operator_user = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    finished_at = Column(DateTime, nullable=True)


# ── 14. notification (v2.3) ──
class Notification(Base):
    __tablename__ = "notification"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    type = Column(String(32), nullable=False, default="info")  # info/success/warning/error
    is_read = Column(SmallInteger, nullable=False, default=0)
    related_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 15. field_change_log (v2.0) ──
class FieldChangeLog(Base):
    __tablename__ = "field_change_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    writeback_log_id = Column(Integer, nullable=False, index=True)
    row_pk_value = Column(String(500), nullable=False)
    field_name = Column(String(128), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    change_type = Column(String(32), nullable=False)  # update / insert / delete
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 16. ai_config (v3.0) ──
class AIConfig(Base):
    __tablename__ = "ai_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ai_enabled = Column(SmallInteger, nullable=False, default=1)  # 1=on, 0=off
    engine_mode = Column(String(32), nullable=False, default="builtin")  # builtin / local / cloud

    # ── Legacy columns (kept for backward compat, unused after migration) ──
    platform_name = Column(String(64), nullable=True)
    api_protocol = Column(String(32), nullable=True, default="openai")
    api_url = Column(String(500), nullable=True)
    api_key_encrypted = Column(Text, nullable=True)
    model_name = Column(String(128), nullable=True)
    max_tokens = Column(Integer, nullable=False, default=4096)
    temperature = Column(Float, nullable=False, default=0.3)

    # ── Local model config (independent) ──
    local_api_protocol = Column(String(32), nullable=True, default="openai")
    local_api_url = Column(String(500), nullable=True)
    local_api_key_encrypted = Column(Text, nullable=True)
    local_model_name = Column(String(128), nullable=True)
    local_max_tokens = Column(Integer, nullable=True, default=4096)
    local_temperature = Column(Float, nullable=True, default=0.3)

    # ── Cloud LLM config (independent) ──
    cloud_platform_name = Column(String(64), nullable=True)
    cloud_api_protocol = Column(String(32), nullable=True, default="openai")
    cloud_api_url = Column(String(500), nullable=True)
    cloud_api_key_encrypted = Column(Text, nullable=True)
    cloud_model_name = Column(String(128), nullable=True)
    cloud_max_tokens = Column(Integer, nullable=True, default=4096)
    cloud_temperature = Column(Float, nullable=True, default=0.3)

    feature_flags = Column(Text, nullable=True)  # JSON: 7 feature toggles
    updated_by = Column(String(64), nullable=False, default="system")
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


# ── 16b. smart_import_mapping_template (v3.0-P2) ──
class MappingTemplate(AuditMixin, Base):
    __tablename__ = "smart_import_mapping_template"

    id = Column(Integer, primary_key=True, autoincrement=True)
    template_name = Column(String(128), nullable=False)
    target_table_id = Column(Integer, nullable=False)
    mappings_json = Column(Text, nullable=False)  # JSON: [{source_pattern, target_field, match_type}]
    source_headers_json = Column(Text, nullable=True)  # JSON: original headers for template matching
    use_count = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime, nullable=True)


# ── 17. health_check_result (v3.0-P2) ──
class HealthCheckResult(Base):
    __tablename__ = "health_check_result"

    id = Column(Integer, primary_key=True, autoincrement=True)
    check_batch_no = Column(String(64), nullable=False, index=True)
    datasource_id = Column(Integer, nullable=False, index=True)
    table_config_id = Column(Integer, nullable=True)
    check_item = Column(String(64), nullable=False)  # connection/table_exists/structure/response_time/row_count
    check_status = Column(String(32), nullable=False)  # ok/warning/error/info
    check_message = Column(String(1000), nullable=True)
    detail_json = Column(Text, nullable=True)  # Extra info (e.g. old/new hash, row count)
    response_time_ms = Column(Integer, nullable=True)
    operator_user = Column(String(64), nullable=False, default="system")
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 18. health_check_config (v3.0-P2) ──
class HealthCheckConfig(Base):
    __tablename__ = "health_check_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    check_interval_minutes = Column(Integer, nullable=False, default=60)
    auto_check_enabled = Column(SmallInteger, nullable=False, default=0)
    notify_on_error = Column(SmallInteger, nullable=False, default=1)
    slow_threshold_ms = Column(Integer, nullable=False, default=5000)
    updated_by = Column(String(64), nullable=False, default="system")
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


# ── 19. scheduled_task (v3.1) ──
class ScheduledTask(Base):
    __tablename__ = "scheduled_task"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False)
    type = Column(String(32), nullable=False)  # health_check / platform_backup / data_export
    schedule_json = Column(Text, nullable=False)  # JSON: {type: "cron"/"interval", ...}
    enabled = Column(SmallInteger, nullable=False, default=1)
    config_json = Column(Text, nullable=True)  # JSON: task-specific config
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)


# ── 20. task_execution_log (v3.1) ──
class TaskExecutionLog(Base):
    __tablename__ = "task_execution_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, nullable=False, index=True)
    started_at = Column(DateTime, nullable=False, default=_now_bjt)
    finished_at = Column(DateTime, nullable=True)
    status = Column(String(32), nullable=False, default="running")  # running/success/failed
    result_summary = Column(String(1000), nullable=True)
    error_message = Column(String(1000), nullable=True)


# ── 21. plugin_status (v4.6) ──
class PluginStatus(Base):
    __tablename__ = "plugin_status"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plugin_id = Column(String(100), unique=True, nullable=False)
    enabled = Column(Boolean, default=False)
    enabled_by = Column(String(100), nullable=True)
    enabled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now_bjt)
    updated_at = Column(DateTime, nullable=False, default=_now_bjt, onupdate=_now_bjt)


# ── 22. activation_record (v5.0) ──
class ActivationRecord(Base):
    __tablename__ = "activation_record"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(64), unique=True, nullable=False)
    product = Column(String(64), nullable=False)
    plugin_keys = Column(Text, nullable=False)  # JSON array string
    expires_at = Column(DateTime, nullable=True)  # null = permanent
    activated_at = Column(DateTime, nullable=False, default=_now_bjt)
    signature = Column(Text, nullable=False)


# ── 23. trial_activation (v5.1) ──
class TrialActivation(Base):
    __tablename__ = "trial_activation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    activation_type = Column(String(32), nullable=False, default="wechat_login")  # wechat_login / manual
    activated_at = Column(DateTime, nullable=False, default=_now_bjt)
    expires_at = Column(DateTime, nullable=False)
    account_id = Column(String(128), nullable=True, index=True)  # unified auth account id


## UserPluginPermission already defined at line 257 (v5.1)
