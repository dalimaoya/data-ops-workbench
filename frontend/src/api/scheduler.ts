import { api } from './request';

export interface ScheduleConfig {
  type: string;
  hour?: number;
  minute?: number;
  second?: number;
  day_of_week?: string;
  day?: string;
  month?: string;
  minutes?: number;
  hours?: number;
  days?: number;
}

export interface ScheduledTask {
  id: number;
  name: string;
  type: string;
  schedule: ScheduleConfig;
  enabled: boolean;
  config: Record<string, any>;
  last_run?: string;
  next_run?: string;
  created_at?: string;
}

export interface TaskExecution {
  id: number;
  task_id: number;
  started_at?: string;
  finished_at?: string;
  status: string;
  result_summary?: string;
  error_message?: string;
}

export const listScheduledTasks = (params?: { page?: number; page_size?: number }) =>
  api.get<{ total: number; items: ScheduledTask[] }>('/scheduler/tasks', { params });

export const createScheduledTask = (data: {
  name: string;
  type: string;
  schedule: ScheduleConfig;
  enabled?: boolean;
  config?: Record<string, any>;
}) => api.post('/scheduler/tasks', data);

export const updateScheduledTask = (id: number, data: {
  name?: string;
  type?: string;
  schedule?: ScheduleConfig;
  enabled?: boolean;
  config?: Record<string, any>;
}) => api.put(`/scheduler/tasks/${id}`, data);

export const deleteScheduledTask = (id: number) =>
  api.delete(`/scheduler/tasks/${id}`);

export const runTaskNow = (id: number) =>
  api.post(`/scheduler/tasks/${id}/run`);

export const getTaskHistory = (id: number, params?: { page?: number; page_size?: number }) =>
  api.get<{ total: number; items: TaskExecution[]; task_name: string }>(`/scheduler/tasks/${id}/history`, { params });
