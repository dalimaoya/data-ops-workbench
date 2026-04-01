import { api } from './request';

// ── Types ──

export interface MultiTableChange {
  row_index: number;
  pk_value: string;
  field: string;
  field_alias: string;
  old_value: string | null;
  new_value: string;
}

export interface MultiTableResult {
  table_id: number;
  table_name: string;
  display_name: string;
  status: 'has_changes' | 'no_change' | 'skipped' | 'error';
  error: string | null;
  rows_changed: number;
  fields_changed: string[];
  total_changes?: number;
  changes: MultiTableChange[];
  explanation?: string;
  engine?: string;
  parsed_rule?: Record<string, unknown>;
}

export interface MultiPreviewSummary {
  tables_affected: number;
  total_rows_changed: number;
  total_tables: number;
}

export interface MultiPreviewData {
  session_id: string;
  summary: MultiPreviewSummary;
  tables: MultiTableResult[];
}

export interface MultiPreviewResponse {
  success: boolean;
  data: MultiPreviewData;
}

export interface TableConfirmation {
  table_id: number;
  confirmed: boolean;
}

export interface MultiConfirmResultItem {
  table_id: number;
  table_name: string;
  status: string;
  updated?: number;
  failed?: number;
  backup_table?: string;
  writeback_batch_no?: string;
  error?: string | null;
}

export interface MultiConfirmResponse {
  success: boolean;
  data: {
    status: string;
    tables_success: number;
    tables_failed: number;
    results: MultiConfirmResultItem[];
  };
}

// ── API calls ──

export const batchFillMultiPreview = (
  tableIds: number[],
  ruleText: string,
  scope: string = 'multi',
) =>
  api.post<MultiPreviewResponse>('/ai/batch-fill-multi', {
    table_ids: tableIds,
    rule_text: ruleText,
    scope,
  });

export const multiConfirm = (
  sessionId: string,
  confirmations: TableConfirmation[],
) =>
  api.post<MultiConfirmResponse>('/writeback/multi-confirm', {
    session_id: sessionId,
    confirmations,
  });
