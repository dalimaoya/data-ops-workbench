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

export const nlQuery = (data: NLQueryRequest) =>
  api.post<{ success: boolean; data: NLQueryResult }>('/ai/nl-query', data);
