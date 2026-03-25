import { api } from './request';

export interface Datasource {
  id: number;
  datasource_code: string;
  datasource_name: string;
  db_type: string;
  host: string;
  port: number;
  database_name?: string;
  schema_name?: string;
  username: string;
  charset?: string;
  connect_timeout_seconds?: number;
  status: string;
  last_test_status?: string;
  last_test_message?: string;
  last_test_at?: string;
  remark?: string;
  created_at: string;
  updated_at: string;
}

export interface DatasourceCreate {
  datasource_name: string;
  db_type: string;
  host: string;
  port: number;
  database_name?: string;
  schema_name?: string;
  username: string;
  password: string;
  charset?: string;
  connect_timeout_seconds?: number;
  status?: string;
  remark?: string;
}

export interface TestConnectionReq {
  db_type: string;
  host: string;
  port: number;
  database_name?: string;
  schema_name?: string;
  username: string;
  password: string;
  charset?: string;
  connect_timeout_seconds?: number;
}

export const listDatasources = (params?: Record<string, unknown>) =>
  api.get<Datasource[]>('/datasource', { params });

export const countDatasources = (params?: Record<string, unknown>) =>
  api.get<{ total: number }>('/datasource/count', { params });

export const getDatasource = (id: number) =>
  api.get<Datasource>(`/datasource/${id}`);

export const createDatasource = (data: DatasourceCreate) =>
  api.post<Datasource>('/datasource', data);

export const updateDatasource = (id: number, data: Partial<DatasourceCreate>) =>
  api.put<Datasource>(`/datasource/${id}`, data);

export const deleteDatasource = (id: number) =>
  api.delete(`/datasource/${id}`);

export const testConnection = (data: TestConnectionReq) =>
  api.post<{ success: boolean; message: string }>('/datasource/test-connection', data);

export const testExistingDatasource = (id: number) =>
  api.post<{ success: boolean; message: string }>(`/datasource/${id}/test`);
