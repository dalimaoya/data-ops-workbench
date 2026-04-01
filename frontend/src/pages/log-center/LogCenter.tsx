import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tabs, Input, Select, DatePicker, Button, Tag, Row, Col, message, Modal,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  listSystemLogs, listExportLogs, listImportLogs, listWritebackLogs, listFieldChanges,
  type SystemLog, type ExportLog, type ImportLog, type WritebackLogItem, type FieldChangeItem,
} from '../../api/logs';
import { listDatasources } from '../../api/datasource';
import { listExportTasks, downloadExportTask, retryImportValidation, type ExportTaskItem } from '../../api/dataMaintenance';
import { useNavigate as useLogNavigate } from 'react-router-dom';
import { formatBeijingTime } from '../../utils/formatTime';
import { useTranslation } from 'react-i18next';
import AILogAnalysis from './AILogAnalysis';

const { RangePicker } = DatePicker;

// ─── Shared Filter Bar ───
function FilterBar({
  dsOptions, filters, setFilters, onSearch, onReset, extraFields,
}: {
  dsOptions: { value: number; label: string }[];
  filters: Record<string, any>;
  setFilters: (f: Record<string, any>) => void;
  onSearch: () => void;
  onReset: () => void;
  extraFields?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
      <Col>
        <Select placeholder={t('common.datasource')} allowClear style={{ width: 180 }}
          options={dsOptions} value={filters.datasource_id}
          onChange={v => setFilters({ ...filters, datasource_id: v })}
        />
      </Col>
      <Col>
        <Input placeholder={t('common.tableName')} allowClear style={{ width: 140 }}
          value={filters.table_name}
          onChange={e => setFilters({ ...filters, table_name: e.target.value })}
        />
      </Col>
      {extraFields}
      <Col>
        <Input placeholder={t('common.operator')} allowClear style={{ width: 120 }}
          value={filters.operator_user}
          onChange={e => setFilters({ ...filters, operator_user: e.target.value })}
        />
      </Col>
      <Col>
        <RangePicker showTime value={filters.timeRange}
          onChange={v => setFilters({ ...filters, timeRange: v })}
        />
      </Col>
      <Col><Button type="primary" onClick={onSearch}>{t('common.search')}</Button></Col>
      <Col><Button onClick={onReset}>{t('common.reset')}</Button></Col>
    </Row>
  );
}

const statusTag = (s: string) => {
  const colorMap: Record<string, string> = {
    success: 'green', failed: 'red', partial: 'orange', warning: 'gold',
    running: 'blue', validated: 'cyan', uploaded: 'default', confirmed: 'green',
  };
  return <Tag color={colorMap[s] || 'default'}>{s}</Tag>;
};

// ─── System Logs Tab ───
function SystemLogTab({ dsOptions: _dsOptions }: { dsOptions: { value: number; label: string }[] }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SystemLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const defaultFilters = { datasource_id: undefined, table_name: '', operator_user: '', timeRange: null, operation_module: '', operation_type: '', operation_status: undefined };
  const [filters, setFilters] = useState<Record<string, any>>(defaultFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (filters.operation_module) params.operation_module = filters.operation_module;
      if (filters.operation_type) params.operation_type = filters.operation_type;
      if (filters.operator_user) params.operator_user = filters.operator_user;
      if (filters.operation_status) params.operation_status = filters.operation_status;
      if (filters.timeRange) {
        params.start_time = filters.timeRange[0].format('YYYY-MM-DDTHH:mm:ss');
        params.end_time = filters.timeRange[1].format('YYYY-MM-DDTHH:mm:ss');
      }
      const res = await listSystemLogs(params);
      setData(res.data.items);
      setTotal(res.data.total);
    } catch { message.error(t('logCenter.loadFailed.system')); }
    finally { setLoading(false); }
  }, [page, pageSize, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const moduleOptions = [
    { value: t('logCenter.moduleOptions.datasource'), label: t('logCenter.moduleOptions.datasource') },
    { value: t('logCenter.moduleOptions.tableConfig'), label: t('logCenter.moduleOptions.tableConfig') },
    { value: t('logCenter.moduleOptions.dataMaintenance'), label: t('logCenter.moduleOptions.dataMaintenance') },
  ];

  const columns: ColumnsType<SystemLog> = [
    { title: t('common.time'), dataIndex: 'created_at', width: 180, render: (v: string) => formatBeijingTime(v) },
    { title: t('logCenter.module'), dataIndex: 'operation_module', width: 120 },
    { title: t('logCenter.operationType'), dataIndex: 'operation_type', width: 120 },
    { title: t('logCenter.target'), dataIndex: 'target_name', width: 180 },
    { title: t('common.status'), dataIndex: 'operation_status', width: 90, render: v => statusTag(v) },
    { title: t('common.operator'), dataIndex: 'operator_user', width: 100 },
    { title: t('logCenter.details'), dataIndex: 'operation_message', ellipsis: true },
  ];

  return (
    <>
      <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
        <Col>
          <Select placeholder={t('logCenter.module')} allowClear style={{ width: 150 }}
            options={moduleOptions}
            value={filters.operation_module || undefined}
            onChange={v => setFilters({ ...filters, operation_module: v })}
          />
        </Col>
        <Col>
          <Input placeholder={t('logCenter.operationType')} allowClear style={{ width: 140 }}
            value={filters.operation_type}
            onChange={e => setFilters({ ...filters, operation_type: e.target.value })}
          />
        </Col>
        <Col>
          <Input placeholder={t('common.operator')} allowClear style={{ width: 120 }}
            value={filters.operator_user}
            onChange={e => setFilters({ ...filters, operator_user: e.target.value })}
          />
        </Col>
        <Col>
          <Select placeholder={t('common.status')} allowClear style={{ width: 120 }}
            options={['success','failed','warning'].map(v => ({ value: v, label: v }))}
            value={filters.operation_status}
            onChange={v => setFilters({ ...filters, operation_status: v })}
          />
        </Col>
        <Col>
          <RangePicker showTime value={filters.timeRange}
            onChange={v => setFilters({ ...filters, timeRange: v })}
          />
        </Col>
        <Col><Button type="primary" onClick={() => { setPage(1); fetchData(); }}>{t('common.search')}</Button></Col>
        <Col><Button onClick={() => { setFilters(defaultFilters); setPage(1); }}>{t('common.reset')}</Button></Col>
      </Row>
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading}
        scroll={{ x: 900 }}
        pagination={{ current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['20','50','100'], showTotal: (total) => t('common.total', { count: total }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </>
  );
}

// ─── Export Logs Tab ───
function ExportLogTab({ dsOptions }: { dsOptions: { value: number; label: string }[] }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExportLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const defaultFilters = { datasource_id: undefined, table_name: '', operator_user: '', timeRange: null };
  const [filters, setFilters] = useState<Record<string, any>>(defaultFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (filters.datasource_id) params.datasource_id = filters.datasource_id;
      if (filters.table_name) params.table_name = filters.table_name;
      if (filters.operator_user) params.operator_user = filters.operator_user;
      if (filters.timeRange) {
        params.start_time = filters.timeRange[0].format('YYYY-MM-DDTHH:mm:ss');
        params.end_time = filters.timeRange[1].format('YYYY-MM-DDTHH:mm:ss');
      }
      const res = await listExportLogs(params);
      setData(res.data.items);
      setTotal(res.data.total);
    } catch { message.error(t('logCenter.loadFailed.export')); }
    finally { setLoading(false); }
  }, [page, pageSize, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnsType<ExportLog> = [
    { title: t('logCenter.batchNo'), dataIndex: 'export_batch_no', width: 200 },
    { title: t('common.datasource'), dataIndex: 'datasource_name', width: 150 },
    { title: t('common.tableName'), dataIndex: 'table_name', width: 140, render: (v, r) => r.table_alias ? `${r.table_alias}（${v}）` : v },
    { title: t('logCenter.exportType'), dataIndex: 'export_type', width: 100 },
    { title: t('logCenter.rowCount'), dataIndex: 'row_count', width: 80 },
    { title: t('logCenter.fieldCount'), dataIndex: 'field_count', width: 80 },
    { title: t('logCenter.fileName'), dataIndex: 'file_name', width: 200, ellipsis: true },
    { title: t('common.operator'), dataIndex: 'operator_user', width: 100 },
    { title: t('common.time'), dataIndex: 'created_at', width: 180, render: (v: string) => formatBeijingTime(v) },
  ];

  return (
    <>
      <FilterBar dsOptions={dsOptions} filters={filters} setFilters={setFilters}
        onSearch={() => { setPage(1); fetchData(); }}
        onReset={() => { setFilters(defaultFilters); setPage(1); }}
      />
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading}
        scroll={{ x: 1200 }}
        pagination={{ current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['20','50','100'], showTotal: (total) => t('common.total', { count: total }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </>
  );
}

// ─── Import Logs Tab ───
function ImportLogTab({ dsOptions, onRetryNavigate }: { dsOptions: { value: number; label: string }[]; onRetryNavigate?: (taskId: number) => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ImportLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const defaultFilters = { datasource_id: undefined, table_name: '', operator_user: '', timeRange: null, validation_status: undefined };
  const [filters, setFilters] = useState<Record<string, any>>(defaultFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (filters.datasource_id) params.datasource_id = filters.datasource_id;
      if (filters.table_name) params.table_name = filters.table_name;
      if (filters.operator_user) params.operator_user = filters.operator_user;
      if (filters.validation_status) params.validation_status = filters.validation_status;
      if (filters.timeRange) {
        params.start_time = filters.timeRange[0].format('YYYY-MM-DDTHH:mm:ss');
        params.end_time = filters.timeRange[1].format('YYYY-MM-DDTHH:mm:ss');
      }
      const res = await listImportLogs(params);
      setData(res.data.items);
      setTotal(res.data.total);
    } catch { message.error(t('logCenter.loadFailed.import')); }
    finally { setLoading(false); }
  }, [page, pageSize, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [retrying, setRetrying] = useState<number | null>(null);

  const handleRetry = async (taskId: number) => {
    setRetrying(taskId);
    try {
      const res = await retryImportValidation(taskId);
      const result = res.data;
      message.success(t('logCenter.retrySuccess'));
      fetchData();
      if (onRetryNavigate && result.task_id) {
        onRetryNavigate(result.task_id);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || t('logCenter.retryFailed');
      message.error(msg);
    } finally {
      setRetrying(null);
    }
  };

  const columns: ColumnsType<ImportLog> = [
    { title: t('logCenter.batchNo'), dataIndex: 'import_batch_no', width: 200 },
    { title: t('common.datasource'), dataIndex: 'datasource_name', width: 150 },
    { title: t('common.tableName'), dataIndex: 'table_name', width: 140, render: (v, r) => r.table_alias ? `${r.table_alias}（${v}）` : v },
    { title: t('logCenter.fileName'), dataIndex: 'import_file_name', width: 200, ellipsis: true },
    { title: t('logCenter.totalRows'), dataIndex: 'total_row_count', width: 80 },
    { title: t('logCenter.passedCount'), dataIndex: 'passed_row_count', width: 80 },
    { title: t('logCenter.failedCount'), dataIndex: 'failed_row_count', width: 80 },
    { title: t('logCenter.validationStatus'), dataIndex: 'validation_status', width: 100, render: v => statusTag(v) },
    { title: t('logCenter.importStatus'), dataIndex: 'import_status', width: 100, render: v => statusTag(v) },
    { title: t('common.operator'), dataIndex: 'operator_user', width: 100 },
    { title: t('common.time'), dataIndex: 'created_at', width: 180, render: (v: string) => formatBeijingTime(v) },
    {
      title: t('common.operation'), width: 100, fixed: 'right',
      render: (_: unknown, record: ImportLog) => {
        if (record.validation_status === 'failed' || record.validation_status === 'partial') {
          return (
            <Button
              type="link"
              size="small"
              loading={retrying === record.id}
              onClick={() => handleRetry(record.id)}
            >
              {t('logCenter.retry')}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <>
      <FilterBar dsOptions={dsOptions} filters={filters} setFilters={setFilters}
        onSearch={() => { setPage(1); fetchData(); }}
        onReset={() => { setFilters(defaultFilters); setPage(1); }}
        extraFields={
          <Col>
            <Select placeholder={t('logCenter.validationStatus')} allowClear style={{ width: 130 }}
              options={['success','failed','partial'].map(v => ({ value: v, label: v }))}
              value={filters.validation_status}
              onChange={v => setFilters({ ...filters, validation_status: v })}
            />
          </Col>
        }
      />
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading}
        scroll={{ x: 1400 }}
        pagination={{ current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['20','50','100'], showTotal: (total) => t('common.total', { count: total }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </>
  );
}

// ─── Field Change Detail Modal ───
function FieldChangeModal({
  writebackLogId, open, onClose,
}: {
  writebackLogId: number; open: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FieldChangeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [fieldNameFilter, setFieldNameFilter] = useState('');
  const [changeTypeFilter, setChangeTypeFilter] = useState<string | undefined>();

  const changeTypeTag = (s: string) => {
    const map: Record<string, { color: string; label: string }> = {
      update: { color: 'orange', label: t('logCenter.changeUpdate') },
      insert: { color: 'green', label: t('logCenter.changeInsert') },
      delete: { color: 'red', label: t('logCenter.changeDelete') },
    };
    const info = map[s] || { color: 'default', label: s };
    return <Tag color={info.color}>{info.label}</Tag>;
  };

  const fetchData = useCallback(async () => {
    if (!open || !writebackLogId) return;
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (fieldNameFilter) params.field_name = fieldNameFilter;
      if (changeTypeFilter) params.change_type = changeTypeFilter;
      const res = await listFieldChanges(writebackLogId, params);
      setData(res.data.items);
      setTotal(res.data.total);
    } catch {
      message.error(t('logCenter.loadFailed.fieldChange'));
    } finally {
      setLoading(false);
    }
  }, [writebackLogId, open, page, pageSize, fieldNameFilter, changeTypeFilter]);

  useEffect(() => {
    if (open) {
      setPage(1);
      fetchData();
    }
  }, [open, writebackLogId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnsType<FieldChangeItem> = [
    { title: t('logCenter.rowPkValue'), dataIndex: 'row_pk_value', width: 180 },
    { title: t('logCenter.fieldNameCol'), dataIndex: 'field_name', width: 150 },
    {
      title: t('logCenter.oldValue'), dataIndex: 'old_value', ellipsis: true,
      render: (v: string | null) => v !== null ? <span style={{ color: '#999' }}>{v}</span> : <span style={{ color: '#ccc', fontStyle: 'italic' }}>NULL</span>,
    },
    {
      title: t('logCenter.newValue'), dataIndex: 'new_value', ellipsis: true,
      render: (v: string | null) => v !== null ? <span style={{ color: '#1890ff', fontWeight: 500 }}>{v}</span> : <span style={{ color: '#ccc', fontStyle: 'italic' }}>NULL</span>,
    },
    { title: t('logCenter.changeTypeCol'), dataIndex: 'change_type', width: 90, render: v => changeTypeTag(v) },
  ];

  return (
    <Modal
      title={t('logCenter.changeDetailTitle')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnClose
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col>
          <Input placeholder={t('logCenter.fieldNameCol')} allowClear style={{ width: 150 }}
            value={fieldNameFilter}
            onChange={e => setFieldNameFilter(e.target.value)}
            onPressEnter={() => { setPage(1); fetchData(); }}
          />
        </Col>
        <Col>
          <Select placeholder={t('logCenter.changeTypeCol')} allowClear style={{ width: 120 }}
            value={changeTypeFilter}
            onChange={v => { setChangeTypeFilter(v); setPage(1); }}
            options={[
              { value: 'update', label: t('logCenter.changeUpdate') },
              { value: 'insert', label: t('logCenter.changeInsert') },
              { value: 'delete', label: t('logCenter.changeDelete') },
            ]}
          />
        </Col>
        <Col>
          <Button type="primary" onClick={() => { setPage(1); fetchData(); }}>{t('common.search')}</Button>
        </Col>
      </Row>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{
          current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['50', '100', '200'],
          showTotal: (total) => t('common.total', { count: total }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="small"
      />
    </Modal>
  );
}

// ─── Writeback Logs Tab ───
function WritebackLogTab({ dsOptions }: { dsOptions: { value: number; label: string }[] }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WritebackLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const defaultFilters = { datasource_id: undefined, table_name: '', operator_user: '', timeRange: null, writeback_status: undefined };
  const [filters, setFilters] = useState<Record<string, any>>(defaultFilters);

  // Field change detail modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedWbLogId, setSelectedWbLogId] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (filters.datasource_id) params.datasource_id = filters.datasource_id;
      if (filters.table_name) params.table_name = filters.table_name;
      if (filters.operator_user) params.operator_user = filters.operator_user;
      if (filters.writeback_status) params.writeback_status = filters.writeback_status;
      if (filters.timeRange) {
        params.start_time = filters.timeRange[0].format('YYYY-MM-DDTHH:mm:ss');
        params.end_time = filters.timeRange[1].format('YYYY-MM-DDTHH:mm:ss');
      }
      const res = await listWritebackLogs(params);
      setData(res.data.items);
      setTotal(res.data.total);
    } catch { message.error(t('logCenter.loadFailed.writeback')); }
    finally { setLoading(false); }
  }, [page, pageSize, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnsType<WritebackLogItem> = [
    { title: t('logCenter.batchNo'), dataIndex: 'writeback_batch_no', width: 200 },
    { title: t('common.datasource'), dataIndex: 'datasource_name', width: 150 },
    { title: t('common.tableName'), dataIndex: 'table_name', width: 140, render: (v, r) => r.table_alias ? `${r.table_alias}（${v}）` : v },
    { title: t('common.operator'), dataIndex: 'operator_user', width: 100 },
    { title: t('logCenter.updated'), dataIndex: 'updated_row_count', width: 70 },
    { title: t('logCenter.inserted'), dataIndex: 'inserted_row_count', width: 70 },
    { title: t('logCenter.deleted'), dataIndex: 'deleted_row_count', width: 70 },
    { title: t('logCenter.failed'), dataIndex: 'failed_row_count', width: 70 },
    { title: t('logCenter.backupVersionNo'), dataIndex: 'backup_version_no', width: 200 },
    { title: t('logCenter.operationTime'), dataIndex: 'started_at', width: 180, render: (v: string) => formatBeijingTime(v) },
    { title: t('common.status'), dataIndex: 'writeback_status', width: 100, render: v => statusTag(v) },
    {
      title: t('common.operation'), width: 100, fixed: 'right',
      render: (_: unknown, record: WritebackLogItem) => (
        <Button type="link" size="small" onClick={() => { setSelectedWbLogId(record.id); setDetailModalOpen(true); }}>
          {t('logCenter.changeDetail')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <FilterBar dsOptions={dsOptions} filters={filters} setFilters={setFilters}
        onSearch={() => { setPage(1); fetchData(); }}
        onReset={() => { setFilters(defaultFilters); setPage(1); }}
        extraFields={
          <Col>
            <Select placeholder={t('common.status')} allowClear style={{ width: 130 }}
              options={['success','failed','partial','running'].map(v => ({ value: v, label: v }))}
              value={filters.writeback_status}
              onChange={v => setFilters({ ...filters, writeback_status: v })}
            />
          </Col>
        }
      />
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading}
        scroll={{ x: 1600 }}
        pagination={{ current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['20','50','100'], showTotal: (total) => t('common.total', { count: total }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      <FieldChangeModal
        writebackLogId={selectedWbLogId}
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
      />
    </>
  );
}

// ─── Export Tasks Tab (v2.3) ───
function ExportTaskTab() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExportTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listExportTasks({ page, page_size: pageSize });
      setData(res.data.items);
      setTotal(res.data.total);
    } catch { message.error(t('logCenter.loadFailed.exportTask')); }
    finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto refresh every 5s if there are processing tasks
  useEffect(() => {
    if (data.some(d => d.status === 'processing')) {
      const timer = setInterval(fetchData, 5000);
      return () => clearInterval(timer);
    }
  }, [data, fetchData]);

  const handleDownload = async (taskId: string, fileName?: string) => {
    try {
      const res = await downloadExportTask(taskId);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'export.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error(t('logCenter.downloadFailed'));
    }
  };

  const columns: ColumnsType<ExportTaskItem> = [
    { title: t('logCenter.taskId'), dataIndex: 'task_id', width: 160 },
    { title: t('common.tableName'), dataIndex: 'table_alias', width: 150, render: (v, r) => v || r.table_name || '-' },
    { title: t('logCenter.exportType'), dataIndex: 'export_type', width: 100 },
    { title: t('logCenter.rowCount'), dataIndex: 'row_count', width: 80, render: v => v ?? '-' },
    {
      title: t('common.status'), dataIndex: 'status', width: 100,
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          processing: { color: 'blue', label: t('logCenter.statusProcessing') },
          completed: { color: 'green', label: t('logCenter.statusCompleted') },
          failed: { color: 'red', label: t('logCenter.statusFailed') },
        };
        const info = map[v] || { color: 'default', label: v };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    { title: t('common.operator'), dataIndex: 'operator_user', width: 100 },
    { title: t('logCenter.createdTime'), dataIndex: 'created_at', width: 180, render: (v: string) => formatBeijingTime(v) },
    { title: t('logCenter.finishedTime'), dataIndex: 'finished_at', width: 180, render: (v: string) => v ? formatBeijingTime(v) : '-' },
    {
      title: t('common.operation'), width: 100, fixed: 'right',
      render: (_: unknown, record: ExportTaskItem) => {
        if (record.status === 'completed') {
          return (
            <Button type="link" size="small" onClick={() => handleDownload(record.task_id, record.file_name || undefined)}>
              {t('common.download')}
            </Button>
          );
        }
        if (record.status === 'failed') {
          return <Tag color="red" style={{ fontSize: 11 }}>{record.error_message?.slice(0, 30) || t('logCenter.statusFailed')}</Tag>;
        }
        return <Tag color="blue">{t('logCenter.processing')}</Tag>;
      },
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button onClick={() => fetchData()}>{t('common.refresh')}</Button>
      </div>
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading}
        scroll={{ x: 1100 }}
        pagination={{ current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['20','50','100'], showTotal: (total) => t('common.total', { count: total }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </>
  );
}

// ─── Main Component ───
export default function LogCenter() {
  const { t } = useTranslation();
  const [dsOptions, setDsOptions] = useState<{ value: number; label: string }[]>([]);
  const logNav = useLogNavigate();

  useEffect(() => {
    listDatasources().then(res => {
      const list = Array.isArray(res.data) ? res.data : [];
      setDsOptions(list.map((d: any) => ({ value: d.id, label: d.datasource_name })));
    });
  }, []);

  const handleRetryNavigate = (taskId: number) => {
    logNav(`/data-maintenance/diff/${taskId}`);
  };

  const items = [
    { key: 'system', label: t('logCenter.systemLog'), children: <SystemLogTab dsOptions={dsOptions} /> },
    { key: 'export', label: t('logCenter.exportLog'), children: <ExportLogTab dsOptions={dsOptions} /> },
    { key: 'export-tasks', label: t('logCenter.exportTasks'), children: <ExportTaskTab /> },
    { key: 'import', label: t('logCenter.importLog'), children: <ImportLogTab dsOptions={dsOptions} onRetryNavigate={handleRetryNavigate} /> },
    { key: 'writeback', label: t('logCenter.writebackLog'), children: <WritebackLogTab dsOptions={dsOptions} /> },
    { key: 'ai-analysis', label: '🤖 ' + t('aiLog.tabTitle'), children: <AILogAnalysis /> },
  ];

  return (
    <Card title={t('logCenter.title')}>
      <Tabs items={items} />
    </Card>
  );
}
