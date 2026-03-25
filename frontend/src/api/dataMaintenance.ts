import { api } from './request';

export interface MaintenanceTable {
  id: number;
  table_config_code: string;
  datasource_id: number;
  datasource_name?: string;
  db_type?: string;
  db_name?: string;
  schema_name?: string;
  table_name: string;
  table_alias?: string;
  config_version: number;
  structure_check_status?: string;
  field_count?: number;
  allow_insert_rows?: number;
  allow_delete_rows?: number;
  updated_by?: string;
  updated_at?: string;
}

export interface ColumnMeta {
  field_name: string;
  field_alias: string;
  db_data_type: string;
  is_primary_key: number;
  is_editable: number;
  is_system_field: number;
  editable_roles?: string;
}

export interface BrowseResponse {
  columns: ColumnMeta[];
  rows: Record<string, string | null>[];
  total: number;
  page: number;
  page_size: number;
  allow_delete_rows?: number;
}

export interface ExportInfo {
  table_config_id: number;
  table_alias?: string;
  table_name: string;
  config_version: number;
  field_count: number;
  estimated_rows: number;
}

export interface AIWarningItem {
  row: number;
  column: string;
  value?: string;
  check_type: string;
  message: string;
  detail?: string;
  severity: string;
  historical_pattern?: string;
}

export interface ImportResult {
  task_id: number;
  import_batch_no: string;
  validation_status: string;
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  diff_count: number;
  new_count: number;
  errors: Array<{
    row: number;
    field: string;
    type: string;
    value?: string;
    message: string;
  }>;
  warnings_list: Array<{
    row: number;
    field: string;
    type: string;
    message: string;
  }>;
  ai_warnings?: AIWarningItem[];
  ai_warnings_count?: number;
}

export interface DiffRow {
  row_num: number;
  pk_key: string;
  field_name: string;
  field_alias: string;
  old_value: string | null;
  new_value: string | null;
  status: string;
  change_type?: string;  // v2.0: "update" | "insert"
}

export interface DiffResponse {
  task_id: number;
  import_batch_no: string;
  table_config_id: number;
  table_name?: string;
  table_alias?: string;
  config_version?: number;
  operator_user?: string;
  import_time?: string;
  total_rows: number;
  passed_rows: number;
  failed_rows: number;
  diff_count: number;
  new_count: number;
  diff_rows: DiffRow[];
  new_rows?: Array<{ row_num: number; data: Record<string, string | null>; pk_key: string; change_type: string }>;
  validation_status: string;
}

export interface WritebackResult {
  writeback_batch_no: string;
  backup_version_no: string;
  status: string;
  total: number;
  success: number;
  failed: number;
  updated: number;
  inserted: number;
  backup_table: string;
  backup_record_count: number;
  operator_user: string;
  started_at: string;
  finished_at: string;
  failed_details: Array<{ row_num: number; pk_key: string; error: string }>;
}

export interface ImportTaskDetail {
  task_id: number;
  import_batch_no: string;
  table_config_id: number;
  datasource_id: number;
  import_file_name: string;
  template_version?: number;
  total_row_count: number;
  passed_row_count: number;
  warning_row_count: number;
  failed_row_count: number;
  diff_row_count: number;
  new_row_count: number;
  validation_status: string;
  validation_message?: string;
  import_status: string;
  operator_user: string;
  created_at?: string;
  errors: Array<{
    row: number;
    field: string;
    type: string;
    value?: string;
    message: string;
  }>;
}

export interface DeleteRowsResult {
  status: string;
  deleted: number;
  failed: number;
  backup_version_no: string;
  backup_table: string;
  failed_details: Array<{ pk_key: string; error: string }>;
}

// 可维护表列表
export const listMaintenanceTables = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: MaintenanceTable[] }>('/data-maintenance/tables', { params });

// 浏览表数据
export const browseTableData = (tableConfigId: number, params?: Record<string, unknown>) =>
  api.get<BrowseResponse>(`/data-maintenance/${tableConfigId}/data`, { params });

// 导出预估信息
export const getExportInfo = (tableConfigId: number) =>
  api.get<ExportInfo>(`/data-maintenance/${tableConfigId}/export-info`);

// 导出模板（返回文件下载）
export const exportTemplate = (tableConfigId: number, params?: Record<string, unknown>) =>
  api.post(`/data-maintenance/${tableConfigId}/export`, null, {
    params,
    responseType: 'blob',
  });

// 导入模板
export const importTemplate = (tableConfigId: number, file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<ImportResult>(`/data-maintenance/${tableConfigId}/import`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// 导入任务详情
export const getImportTask = (taskId: number) =>
  api.get<ImportTaskDetail>(`/data-maintenance/import-tasks/${taskId}`);

// 差异预览
export const getImportDiff = (taskId: number) =>
  api.get<DiffResponse>(`/data-maintenance/import-tasks/${taskId}/diff`);

// 执行回写
export const executeWriteback = (taskId: number) =>
  api.post<WritebackResult>(`/data-maintenance/import-tasks/${taskId}/writeback`);

// v2.0: 批量删除行
export const deleteRows = (tableConfigId: number, pkValues: string[]) =>
  api.delete<DeleteRowsResult>(`/data-maintenance/${tableConfigId}/rows`, {
    data: { pk_values: pkValues },
  });

// v2.1: 在线编辑 — 行内更新
export interface InlineChange {
  pk_values: Record<string, string>;
  updates: Record<string, string | null>;
}

export interface InlineUpdateResult {
  writeback_batch_no: string;
  backup_version_no: string;
  status: string;
  total: number;
  success: number;
  failed: number;
  updated: number;
  backup_table: string;
  backup_record_count: number;
  change_count: number;
  failed_details: Array<{ pk_key: string; error: string }>;
}

export const inlineUpdate = (tableConfigId: number, changes: InlineChange[]) =>
  api.put<InlineUpdateResult>(`/data-maintenance/${tableConfigId}/inline-update`, { changes });

// v2.1: 在线编辑 — 单行新增
export interface InlineInsertResult {
  writeback_batch_no: string;
  backup_version_no: string;
  status: string;
  pk_key: string;
  backup_table: string;
  backup_record_count: number;
}

export const inlineInsert = (tableConfigId: number, rowData: Record<string, string | null>) =>
  api.post<InlineInsertResult>(`/data-maintenance/${tableConfigId}/inline-insert`, { row_data: rowData });

// v2.1.2: 批量新增行
export interface BatchInsertResult {
  writeback_batch_no: string;
  backup_version_no: string;
  status: string;
  total: number;
  success: number;
  failed: number;
  backup_table: string;
  backup_record_count: number;
  failed_details: Array<{ row_num: number; pk_key: string; error: string }>;
}

export const batchInsert = (tableConfigId: number, rows: Record<string, string | null>[]) =>
  api.post<BatchInsertResult>(`/data-maintenance/${tableConfigId}/batch-insert`, { rows });

// v2.3: Async export
export interface AsyncExportResult {
  task_id: string;
  status: string;
  message: string;
}

export const asyncExport = (tableConfigId: number, params?: Record<string, unknown>) =>
  api.post<AsyncExportResult>(`/data-maintenance/${tableConfigId}/async-export`, null, { params });

// v2.3: Export tasks
export interface ExportTaskItem {
  id: number;
  task_id: string;
  table_config_id: number;
  table_name?: string;
  table_alias?: string;
  export_type: string;
  status: string;
  row_count?: number;
  file_name?: string;
  error_message?: string;
  operator_user: string;
  created_at?: string;
  finished_at?: string;
}

export const listExportTasks = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: ExportTaskItem[] }>('/data-maintenance/export-tasks', { params });

export const downloadExportTask = (taskId: string) =>
  api.get(`/data-maintenance/export-tasks/${taskId}/download`, { responseType: 'blob' });

// v2.3: Batch export (multi-table zip)
export const batchExportTables = (tableConfigIds: number[]) =>
  api.post('/data-maintenance/batch-export', { table_config_ids: tableConfigIds }, { responseType: 'blob' });

// v2.4: Diff report download
export const downloadDiffReport = (taskId: number) =>
  api.get(`/data-maintenance/import-tasks/${taskId}/diff-report`, { responseType: 'blob' });

// v2.4: Retry import validation
export const retryImportValidation = (taskId: number) =>
  api.post<ImportResult>(`/data-maintenance/import-tasks/${taskId}/retry`);

// v3.1: Compare report (Excel / PDF)
export const downloadCompareReport = (tableConfigId: number, importTaskId: number, format: 'excel' | 'pdf') =>
  api.post(`/data-maintenance/${tableConfigId}/compare-report`, {
    format,
    import_task_id: importTaskId,
  }, { responseType: 'blob' });
