import { api } from './request';

export interface NotificationItem {
  id: number;
  title: string;
  message?: string;
  type: string; // info/success/warning/error
  is_read: number;
  related_url?: string;
  created_at?: string;
}

export interface NotificationListResponse {
  total: number;
  unread_count: number;
  items: NotificationItem[];
}

export const listNotifications = (params?: Record<string, unknown>) =>
  api.get<NotificationListResponse>('/notifications', { params });

export const markNotificationRead = (id: number) =>
  api.put(`/notifications/${id}/read`);

export const markAllNotificationsRead = () =>
  api.put('/notifications/read-all');
