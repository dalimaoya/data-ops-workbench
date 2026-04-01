import { api } from './request';

export interface NLQueryFilter {
  field: string;
  operator: string;
  value: unknown;
  display: string;
}

export interface NLQueryResult {
  filters: NLQueryFilter[];
  explanation: string;
  confidence: number;
  sql_preview?: string;
  engine?: string;
}

export interface NLQueryRequest {
  table_id: number;
  query_text: string;
  context?: {
    fields?: Array<{
      name: string;
      display_name?: string;
      type?: string;
      enum_values?: string[];
    }>;
    previous_filters?: NLQueryFilter[];
  };
}

export interface NLQueryExecuteRequest {
  table_id: number;
  filters: NLQueryFilter[];
  sql_preview?: string;
  page?: number;
  page_size?: number;
}

export interface NLQueryExecuteResult {
  columns: Array<{ field_name: string; field_alias: string; db_data_type?: string }>;
  rows: Record<string, string | null>[];
  total: number;
  page: number;
  page_size: number;
}

export const nlQuery = (data: NLQueryRequest) =>
  api.post<{ success: boolean; data: NLQueryResult }>('/ai/nl-query', data);

export const nlQueryExecute = (data: NLQueryExecuteRequest) =>
  api.post<{ success: boolean; data: NLQueryExecuteResult }>('/ai/nl-query/execute', data);
