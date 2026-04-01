import { api } from './request';

export interface FieldRecommendation {
  property: string;       // display_name | is_readonly | is_system_field | enum_values | value_range
  value: any;
  reason: string;
  confidence: number;
}

export interface FieldSuggestion {
  column_name: string;
  recommendations: FieldRecommendation[];
}

export interface FieldSuggestResponse {
  success: boolean;
  data: {
    field_count: number;
    sample_count: number;
    suggestions: FieldSuggestion[];
    engine: string;
    elapsed_ms: number;
  };
}

export interface FieldSuggestRequest {
  table_id: number;
  sample_count?: number;
}

export const getFieldSuggestions = (data: FieldSuggestRequest) =>
  api.post<FieldSuggestResponse>('/ai/field-suggest', data);


// ── Simple format (v4.0) ──

export interface SimpleFieldInput {
  name: string;
  type: string;
}

export interface SimpleFieldSuggestion {
  field_name: string;
  display_name: string;
  is_readonly: boolean;
  is_system: boolean;
  suggested_enum: string[] | null;
}

export interface SimpleFieldSuggestRequest {
  datasource_id?: number;
  table_name?: string;
  fields: SimpleFieldInput[];
}

export interface SimpleFieldSuggestResponse {
  success: boolean;
  data: {
    suggestions: SimpleFieldSuggestion[];
    engine: string;
    elapsed_ms: number;
  };
}

export const getSimpleFieldSuggestions = (data: SimpleFieldSuggestRequest) =>
  api.post<SimpleFieldSuggestResponse>('/ai/field-suggest-simple', data);
