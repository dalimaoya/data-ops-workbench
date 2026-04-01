import { api } from './request';

export interface DashboardStats {
  datasource_count: number;
  table_count: number;
  today_export: number;
  today_import: number;
  today_writeback: number;
  structure_abnormal: number;
}

export interface RecentOperation {
  id: number;
  operation_type: string;
  operation_module: string;
  target_name: string | null;
  table_alias: string | null;
  operation_status: string;
  operation_message: string | null;
  readable_desc: string | null;
  operator_user: string;
  created_at: string | null;
}

export interface Alert {
  type: string;
  level: string;
  title: string;
  message: string;
  target_id: number;
  table_config_id?: number;
  target_name: string;
  created_at: string | null;
}

export interface TrendDay {
  date: string;
  export: number;
  import: number;
  writeback: number;
}

export interface DatasourceHealth {
  id: number;
  name: string;
  code: string;
  db_type: string;
  status: 'ok' | 'error' | 'untested';
  last_test_status: string | null;
  last_test_message: string | null;
  last_test_at: string | null;
}

export interface TopTable {
  table_config_id: number;
  table_name: string;
  datasource_name: string | null;
  op_count: number;
}

export interface TopField {
  field: string;
  count: number;
}

export const getDashboardStats = () =>
  api.get<DashboardStats>('/dashboard/stats');

export const getRecentOperations = () =>
  api.get<RecentOperation[]>('/dashboard/recent-operations');

export const getAlerts = () =>
  api.get<Alert[]>('/dashboard/alerts');

export const getDashboardTrends = (days?: number) =>
  api.get<TrendDay[]>('/dashboard/trends', { params: days ? { days } : undefined });

export const getDatasourceHealth = () =>
  api.get<DatasourceHealth[]>('/dashboard/datasource-health');

export const getTopTables = (days?: number, limit?: number) =>
  api.get<TopTable[]>('/dashboard/top-tables', { params: { ...(days ? { days } : {}), ...(limit ? { limit } : {}) } });

export const getTopFields = (days?: number, limit?: number) =>
  api.get<TopField[]>('/dashboard/top-fields', { params: { ...(days ? { days } : {}), ...(limit ? { limit } : {}) } });
