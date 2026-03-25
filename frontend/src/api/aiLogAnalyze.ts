import { api } from './request';

export interface TimeRange {
  start: string;
  end: string;
}

export interface LogAnalyzeRequest {
  action: 'summary' | 'anomaly' | 'trace';
  time_range: TimeRange;
  table_id?: number | null;
  field_name?: string;
  row_pk?: string;
}

export function logAnalyze(data: LogAnalyzeRequest) {
  return api.post('/ai/log-analyze', data);
}
