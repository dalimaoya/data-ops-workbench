import { api } from './request';

export function runHealthCheck() {
  return api.post('/health-check/run');
}

export function getHealthCheckHistory(params: {
  page?: number;
  page_size?: number;
  datasource_id?: number;
  check_status?: string;
}) {
  return api.get('/health-check/history', { params });
}

export function getHealthCheckConfig() {
  return api.get('/health-check/config');
}

export function updateHealthCheckConfig(data: {
  check_interval_minutes?: number;
  auto_check_enabled?: boolean;
  notify_on_error?: boolean;
  slow_threshold_ms?: number;
}) {
  return api.put('/health-check/config', data);
}
