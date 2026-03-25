import { api } from './request';

export interface BackupVersion {
  id: number;
  backup_version_no: string;
  datasource_id: number;
  datasource_name?: string;
  table_config_id: number;
  table_name: string;
  table_alias?: string;
  backup_table_name: string;
  backup_time?: string;
  trigger_type: string;
  related_writeback_batch_no?: string;
  record_count?: number;
  storage_status: string;
  can_rollback: number;
  operator_user: string;
}

export interface BackupVersionDetail extends BackupVersion {
  db_type?: string;
  source_db_name?: string;
  source_schema_name?: string;
  backup_started_at?: string;
  backup_finished_at?: string;
  remark?: string;
  created_at?: string;
  writeback_info?: {
    writeback_batch_no: string;
    total_row_count: number;
    success_row_count: number;
    failed_row_count: number;
    writeback_status: string;
    started_at?: string;
    finished_at?: string;
  };
}

export interface RollbackResult {
  success: boolean;
  message: string;
  backup_version_no: string;
  pre_rollback_backup_no: string;
  pre_rollback_backup_table: string;
  pre_rollback_record_count: number;
  restored_record_count: number;
  started_at: string;
  finished_at: string;
}

export const listBackupVersions = (params?: Record<string, unknown>) =>
  api.get<{ total: number; items: BackupVersion[] }>('/backup-versions', { params });

export const getBackupVersionDetail = (id: number) =>
  api.get<BackupVersionDetail>(`/backup-versions/${id}`);

export const rollbackVersion = (id: number) =>
  api.post<RollbackResult>(`/backup-versions/${id}/rollback`);
