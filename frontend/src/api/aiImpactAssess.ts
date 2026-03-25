import { api } from './request';

export interface ChangeItem {
  row_pk?: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  change_type?: string;
}

export function impactAssess(data: { table_id: number; changes: ChangeItem[] }) {
  return api.post('/ai/impact-assess', data);
}

export function getFieldSensitivity(tableId: number) {
  return api.get(`/ai/field-sensitivity/${tableId}`);
}

export function updateFieldSensitivity(data: {
  field_id: number;
  sensitivity_level: string;
  sensitivity_note?: string;
}) {
  return api.put('/ai/field-sensitivity', data);
}
