import { api } from './request';

export interface AIValidateRequest {
  table_id: number;
  import_data: Record<string, any>[];
  checks?: string[];
}

export interface AIValidationIssue {
  row: number;
  column: string;
  field_name?: string;
  value?: string;
  check_type: string;
  message: string;
  detail?: string;
  severity: 'warning' | 'error' | 'info';
  historical_pattern?: string;
}

export interface AIValidateStats {
  rows_checked: number;
  total_issues: number;
  error_count: number;
  warning_count: number;
  check_elapsed_ms: number;
  historical_rows: number;
}

export interface AIValidateResponse {
  success: boolean;
  data: {
    warnings: AIValidationIssue[];
    stats: AIValidateStats;
    has_errors: boolean;
    warning_behavior: string;
    message?: string;
  };
}

export const aiDataValidate = (payload: AIValidateRequest) =>
  api.post<AIValidateResponse>('/ai/data-validate', payload);
