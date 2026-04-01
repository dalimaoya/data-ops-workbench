import { api } from './request';

export interface FieldRecommendation {
  property: string;
  value: any;
  reason: string;
  confidence: number;
}

export interface BatchFieldInfo {
  field_name: string;
  db_data_type: string;
  field_order_no: number;
  is_primary_key: number;
  is_editable: number;
  is_required: number;
  is_system_field: number;
  is_displayed: number;
  include_in_export: number;
  include_in_import: number;
  sample_value?: string;
}

export interface BatchTableResult {
  table_name: string;
  status: string;
  error?: string;
  is_managed: boolean;
  table_display_name?: string;
  primary_key?: string;
  fields: BatchFieldInfo[];
  ai_suggestions: Record<string, FieldRecommendation[]>;
  engine?: string;
  field_count?: number;
  sample_count?: number;
}

export interface BatchManageTablesResponse {
  success: boolean;
  data: {
    total: number;
    results: BatchTableResult[];
    elapsed_ms: number;
  };
}

export interface BatchManageTablesRequest {
  datasource_id: number;
  db_name?: string;
  table_names: string[];
  auto_ai_suggest?: boolean;
  sample_count?: number;
}

export interface FieldConfigItem {
  field_name: string;
  field_alias?: string;
  db_data_type: string;
  field_order_no?: number;
  is_primary_key?: number;
  is_editable?: number;
  is_required?: number;
  is_system_field?: number;
  is_displayed?: number;
  include_in_export?: number;
  include_in_import?: number;
  enum_options_json?: string;
  sample_value?: string;
  editable_roles?: string;
  remark?: string;
}

export interface TableConfirmItem {
  table_name: string;
  display_name?: string;
  primary_key: string;
  fields: FieldConfigItem[];
}

export interface BatchConfirmRequest {
  datasource_id: number;
  db_name?: string;
  tables: TableConfirmItem[];
}

export interface BatchConfirmResponse {
  success: boolean;
  data: {
    created: number;
    failed: number;
    tables: Array<{
      table_name: string;
      table_config_id: number;
      display_name: string;
      field_count: number;
    }>;
    errors: Array<{ table_name: string; error: string }>;
  };
}

export interface BatchExportRequest {
  datasource_id: number;
  table_ids: number[];
  format: string;
}

// Batch onboarding + AI suggestions
export const batchManageTables = (data: BatchManageTablesRequest) =>
  api.post<BatchManageTablesResponse>('/batch-manage/tables', data);

// Batch confirm save
export const batchConfirm = (data: BatchConfirmRequest) =>
  api.post<BatchConfirmResponse>('/batch-manage/confirm', data);

// Batch export
export const batchExport = (data: BatchExportRequest) =>
  api.post('/batch-manage/export', data, { responseType: 'blob' });

// Batch import - validate uploaded file
export const batchImportValidate = (file: File, datasourceId: number) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('datasource_id', String(datasourceId));
  return api.post('/batch-manage/import/validate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
};

// Batch import - confirm selected tables
export const batchImportConfirm = (batchImportId: string, tableConfigIds: number[]) =>
  api.post('/batch-manage/import/confirm', {
    batch_import_id: batchImportId,
    table_config_ids: tableConfigIds,
  }, { timeout: 120000 });
