import { api } from './request';

export interface RemoteTableInfo {
  table_name: string;
  table_comment?: string;
  row_count?: number;
}

export interface RemoteTablesResponse {
  datasource_id: number;
  db_name?: string;
  schema_name?: string;
  tables: RemoteTableInfo[];
}

export interface TableConfig {
  id: number;
  table_config_code: string;
  datasource_id: number;
  db_name?: string;
  schema_name?: string;
  table_name: string;
  table_alias?: string;
  table_comment?: string;
  config_version: number;
  structure_version_hash?: string;
  primary_key_fields: string;
  unique_key_fields?: string;
  allow_export_current: number;
  allow_export_all: number;
  allow_import_writeback: number;
  allow_insert_rows: number;
  allow_delete_rows: number;
  backup_keep_count: number;
  strict_template_version: number;
  strict_field_order: number;
  status: string;
  structure_check_status?: string;
  last_structure_check_at?: string;
  last_sync_at?: string;
  remark?: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  template_reserved_blank_rows?: number;
  datasource_name?: string;
  db_type?: string;
  field_count?: number;
}

export interface TableConfigCreate {
  datasource_id: number;
  db_name?: string;
  schema_name?: string;
  table_name: string;
  table_alias?: string;
  table_comment?: string;
  primary_key_fields: string;
  unique_key_fields?: string;
  allow_export_current?: number;
  allow_export_all?: number;
  allow_import_writeback?: number;
  allow_insert_rows?: number;
  allow_delete_rows?: number;
  backup_keep_count?: number;
  strict_template_version?: number;
  strict_field_order?: number;
  template_reserved_blank_rows?: number;
  remark?: string;
}

export interface FieldConfig {
  id: number;
  table_config_id: number;
  field_name: string;
  field_alias?: string;
  db_data_type: string;
  field_order_no: number;
  sample_value?: string;
  is_displayed: number;
  is_editable: number;
  is_required: number;
  is_primary_key: number;
  is_unique_key: number;
  is_system_field: number;
  include_in_export: number;
  include_in_import: number;
  max_length?: number;
  enum_options_json?: string;
  validation_rule_json?: string;
  default_display_type?: string;
  editable_roles?: string;
  sensitivity_level?: string;
  sensitivity_note?: string;
  remark?: string;
  created_at: string;
  updated_at: string;
}

export interface StructureCheckResponse {
  status: string;
  message: string;
  current_hash?: string;
  saved_hash?: string;
}

export interface SampleDataResponse {
  columns: string[];
  rows: (string | null)[][];
  total: number;
}

// Remote tables
export const getRemoteTables = (dsId: number, params?: Record<string, unknown>) =>
  api.get<RemoteTablesResponse>(`/table-config/remote-tables/${dsId}`, { params });

// Table config CRUD
export const listTableConfigs = (params?: Record<string, unknown>) =>
  api.get<TableConfig[]>('/table-config', { params });

export const countTableConfigs = (params?: Record<string, unknown>) =>
  api.get<{ total: number }>('/table-config/count', { params });

export const getTableConfig = (id: number) =>
  api.get<TableConfig>(`/table-config/${id}`);

export const createTableConfig = (data: TableConfigCreate) =>
  api.post<TableConfig>('/table-config', data);

export const updateTableConfig = (id: number, data: Partial<TableConfigCreate>) =>
  api.put<TableConfig>(`/table-config/${id}`, data);

export const deleteTableConfig = (id: number) =>
  api.delete(`/table-config/${id}`);

export const checkStructure = (id: number) =>
  api.post<StructureCheckResponse>(`/table-config/${id}/check-structure`);

export const syncFields = (id: number) =>
  api.post(`/table-config/${id}/sync-fields`);

export const getSampleData = (id: number, limit?: number) =>
  api.get<SampleDataResponse>(`/table-config/${id}/sample-data`, { params: { limit } });

// Field config CRUD
export const listFields = (tableConfigId: number) =>
  api.get<FieldConfig[]>(`/field-config/${tableConfigId}`);

export const updateField = (fieldId: number, data: Partial<FieldConfig>) =>
  api.put<FieldConfig>(`/field-config/${fieldId}`, data);

export const batchUpdateFields = (fieldIds: number[], updates: Partial<FieldConfig>) =>
  api.put('/field-config/batch/update', { field_ids: fieldIds, updates });

export const deleteField = (fieldId: number) =>
  api.delete(`/field-config/${fieldId}`);
