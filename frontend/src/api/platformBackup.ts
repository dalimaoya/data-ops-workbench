import { api } from './request';

export interface BackupRequest {
  include_logs: boolean;
  include_backups: boolean;
  format: string;
}

export interface BackupResult {
  filename: string;
  download_url: string;
  file_size: number;
  file_size_human: string;
  created_at: string;
  manifest: ManifestInfo;
}

export interface ManifestInfo {
  version: string;
  app_version: string;
  created_at: string;
  created_by: string;
  contents: {
    platform_config: boolean;
    users: boolean;
    settings: boolean;
    logs: boolean;
    backups: boolean;
  };
  stats: {
    datasources: number;
    tables: number;
    fields: number;
    users: number;
    log_entries: number;
  };
  checksums: Record<string, string>;
}

export interface BackupHistoryItem {
  filename: string;
  file_size: number;
  file_size_human: string;
  contents: string;
  created_at: string;
  download_url: string;
}

export interface UploadResult {
  filename: string;
  file_size: number;
  file_size_human: string;
  manifest: ManifestInfo;
}

export interface RestoreRequest {
  backup_file: string;
  mode: 'overwrite' | 'merge';
  confirm: boolean;
}

export interface RestoreResult {
  message: string;
  pre_restore_backup: string;
  mode: string;
  backup_version: string;
}

export const createBackup = (data: BackupRequest) =>
  api.post<{ success: boolean; data: BackupResult }>('/platform/backup', data);

export const getBackupHistory = () =>
  api.get<{ success: boolean; data: BackupHistoryItem[] }>('/platform/backup/history');

export const deleteBackup = (filename: string) =>
  api.delete(`/platform/backup/${encodeURIComponent(filename)}`);

export const uploadBackup = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<{ success: boolean; data: UploadResult }>('/platform/backup/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const restorePlatform = (data: RestoreRequest) =>
  api.post<{ success: boolean; data: RestoreResult }>('/platform/restore', data);

export const downloadBackupUrl = (filename: string) =>
  `/api/platform/backup/download/${encodeURIComponent(filename)}`;
