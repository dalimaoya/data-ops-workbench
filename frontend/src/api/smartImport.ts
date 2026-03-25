import { api } from './request';

// ── Parse File ──
export function parseFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/ai/import/parse-file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000, // 2min for large files
  });
}

// ── Match Tables ──
export interface TableDataItem {
  table_index: number;
  source_location?: string;
  title_guess?: string;
  row_count: number;
  col_count: number;
  headers: string[];
  preview_rows: string[][];
  parseable?: boolean;
}

export function matchTables(tables: TableDataItem[], useAi = false) {
  return api.post('/ai/import/match-tables', { tables, use_ai: useAi });
}

// ── Map Fields ──
export function mapFields(sourceHeaders: string[], targetTableId: number, useAi = false) {
  return api.post('/ai/import/map-fields', {
    source_headers: sourceHeaders,
    target_table_id: targetTableId,
    use_ai: useAi,
  });
}

// ── Mapping Templates ──
export function listMappingTemplates(targetTableId?: number) {
  return api.get('/ai/import/mapping-templates', {
    params: targetTableId != null ? { target_table_id: targetTableId } : {},
  });
}

export function createMappingTemplate(data: {
  template_name: string;
  target_table_id: number;
  mappings: any[];
  source_headers: string[];
}) {
  return api.post('/ai/import/mapping-templates', data);
}

export function updateMappingTemplate(id: number, data: { template_name?: string; mappings?: any[] }) {
  return api.put(`/ai/import/mapping-templates/${id}`, data);
}

export function deleteMappingTemplate(id: number) {
  return api.delete(`/ai/import/mapping-templates/${id}`);
}
