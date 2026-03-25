import { api } from './request';

export interface ApprovalItem {
  id: number;
  import_task_id: number | null;
  table_config_id: number;
  table_name: string | null;
  table_alias: string | null;
  datasource_name: string | null;
  request_type: string;
  requested_by: string;
  request_time: string | null;
  status: string;
  approved_by: string | null;
  approve_time: string | null;
  reject_reason: string | null;
  created_at: string | null;
}

export interface ApprovalDetail extends ApprovalItem {
  request_data_json: string | null;
  structure_hash_at_request: string | null;
  diff_preview: {
    diff_rows: Array<Record<string, unknown>>;
    new_rows: Array<Record<string, unknown>>;
  } | null;
}

export const listApprovals = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: ApprovalItem[] }>('/approvals', { params });

export const getApprovalDetail = (id: number) =>
  api.get<ApprovalDetail>(`/approvals/${id}`);

export const approveRequest = (id: number) =>
  api.put(`/approvals/${id}/approve`);

export const rejectRequest = (id: number, reject_reason?: string) =>
  api.put(`/approvals/${id}/reject`, { reject_reason });

export const getApprovalEnabled = () =>
  api.get<{ approval_enabled: boolean }>('/settings/approval-enabled');

export const setApprovalEnabled = (enabled: boolean) =>
  api.put('/settings/approval-enabled', { approval_enabled: enabled });
