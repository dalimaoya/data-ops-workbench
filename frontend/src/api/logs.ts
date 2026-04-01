import { api } from './request';

export interface SystemLog {
  id: number;
  operation_type: string;
  operation_module: string;
  target_id?: number;
  target_code?: string;
  target_name?: string;
  operation_status: string;
  operation_message?: string;
  request_method?: string;
  request_path?: string;
  operator_user: string;
  operator_ip?: string;
  created_at?: string;
}

export interface ExportLog {
  id: number;
  export_batch_no: string;
  datasource_id: number;
  datasource_name?: string;
  table_config_id: number;
  table_name?: string;
  table_alias?: string;
  export_type: string;
  row_count: number;
  field_count: number;
  template_version: number;
  file_name?: string;
  operator_user: string;
  remark?: string;
  created_at?: string;
}

export interface ImportLog {
  id: number;
  import_batch_no: string;
  datasource_id: number;
  datasource_name?: string;
  table_config_id: number;
  table_name?: string;
  table_alias?: string;
  import_file_name: string;
  template_version?: number;
  total_row_count: number;
  passed_row_count: number;
  warning_row_count: number;
  failed_row_count: number;
  diff_row_count: number;
  validation_status: string;
  validation_message?: string;
  import_status: string;
  operator_user: string;
  created_at?: string;
}

export interface WritebackLogItem {
  id: number;
  writeback_batch_no: string;
  import_task_id: number;
  datasource_id: number;
  datasource_name?: string;
  table_config_id: number;
  table_name?: string;
  table_alias?: string;
  backup_version_no?: string;
  file_name?: string;
  total_row_count: number;
  success_row_count: number;
  failed_row_count: number;
  skipped_row_count: number;
  inserted_row_count: number;
  updated_row_count: number;
  deleted_row_count: number;
  writeback_status: string;
  writeback_message?: string;
  operator_user: string;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
}

export interface FieldChangeItem {
  id: number;
  writeback_log_id: number;
  row_pk_value: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  created_at?: string;
}

export const listSystemLogs = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: SystemLog[] }>('/logs/system', { params });

export const listExportLogs = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: ExportLog[] }>('/logs/export', { params });

export const listImportLogs = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: ImportLog[] }>('/logs/import', { params });

export const listWritebackLogs = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: WritebackLogItem[] }>('/logs/writeback', { params });

// v2.0: 逐字段变更明细
export const listFieldChanges = (writebackLogId: number, params?: Record<string, unknown>) =>
  api.get<{ total: number; items: FieldChangeItem[] }>(`/logs/writeback/${writebackLogId}/field-changes`, { params });
