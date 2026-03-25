import { api } from './request';

export interface UserItem {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string | null;
}

export interface CreateUserRequest {
  username: string;
  display_name?: string;
  password: string;
  role: string;
}

export interface UpdateUserRequest {
  display_name?: string;
  role?: string;
}

// 用户管理 (管理员)
export const listUsers = () => api.get<UserItem[]>('/users');

export const createUser = (data: CreateUserRequest) =>
  api.post<UserItem>('/users', data);

export const updateUser = (id: number, data: UpdateUserRequest) =>
  api.put<UserItem>(`/users/${id}`, data);

export const updateUserStatus = (id: number, status: string) =>
  api.put(`/users/${id}/status`, { status });

export const resetUserPassword = (id: number, new_password: string) =>
  api.put(`/users/${id}/reset-password`, { new_password });

// 数据源权限管理 (v2.2)
export interface DatasourcePermissionInfo {
  user_id: number;
  username: string;
  role: string;
  datasource_ids: number[];
  all_datasources: { id: number; datasource_name: string; db_type: string }[];
}

export const getUserDatasourcePermissions = (userId: number) =>
  api.get<DatasourcePermissionInfo>(`/users/${userId}/datasource-permissions`);

export const setUserDatasourcePermissions = (userId: number, datasource_ids: number[]) =>
  api.put(`/users/${userId}/datasource-permissions`, { datasource_ids });

// 个人设置
export const changeMyPassword = (old_password: string, new_password: string) =>
  api.put('/me/password', { old_password, new_password });

export const updateMyProfile = (display_name: string) =>
  api.put('/me/profile', { display_name });
