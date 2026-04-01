import { api } from './request';

export interface BatchFillChange {
  row_index: number;
  pk_value: string;
  field: string;
  field_alias: string;
  old_value: string | null;
  new_value: string;
}

export interface BatchFillPreviewData {
  parsed_rule: Record<string, unknown>;
  affected_rows: number;
  affected_fields: number;
  total_changes: number;
  changes: BatchFillChange[];
  explanation: string;
  engine: string;
}

export interface BatchFillPreviewResponse {
  success: boolean;
  data: BatchFillPreviewData;
}

export interface BatchFillApplyResponse {
  success: boolean;
  task_id: number;
  import_batch_no: string;
  diff_count: number;
  affected_rows: number;
}

export const batchFillPreview = (tableId: number, ruleText: string, dataScope: string = 'all') =>
  api.post<BatchFillPreviewResponse>('/ai/batch-fill', {
    table_id: tableId,
    rule_text: ruleText,
    data_scope: dataScope,
  });

export const batchFillApply = (tableId: number, changes: BatchFillChange[]) =>
  api.post<BatchFillApplyResponse>('/ai/batch-fill/apply', {
    table_id: tableId,
    changes,
  });
