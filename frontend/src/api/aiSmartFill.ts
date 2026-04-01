import { api } from './request';

// ── Types ──

export interface SmartFillPattern {
  type: string;  // "numeric_increment" | "date_increment" | "frequency" | "association" | "llm"
  confidence: number;
  description: string;
  source_field?: string;
  source_alias?: string;
  value?: string;
  step_per_row?: number;
  days_per_row?: number;
  mapping?: Record<string, string>;
}

export interface SmartFillSuggestion {
  row_index: number;
  suggested_value: string;
  confidence: number;
}

export interface SmartFillFieldResult {
  field_alias: string;
  blank_count: number;
  filled_count: number;
  patterns: SmartFillPattern[];
  suggestions: SmartFillSuggestion[];
  engine?: string;
  message?: string;
}

export interface SmartFillDetectResponse {
  success: boolean;
  data: {
    table_id: number;
    table_name: string;
    table_alias: string;
    total_rows: number;
    fields: Record<string, SmartFillFieldResult>;
  };
}

export interface SmartFillApplyResponse {
  success: boolean;
  task_id: number;
  import_batch_no: string;
  fill_count: number;
  affected_rows: number;
}

// ── API calls ──

export const smartFillDetect = (tableId: number, targetFields: string[], useLlm: boolean = false) =>
  api.post<SmartFillDetectResponse>('/ai/smart-fill', {
    table_id: tableId,
    target_fields: targetFields,
    use_llm: useLlm,
  });

export const smartFillApply = (tableId: number, fills: Array<{ row_index: number; field: string; value: string }>) =>
  api.post<SmartFillApplyResponse>('/ai/smart-fill/apply', {
    table_id: tableId,
    fills,
  });
