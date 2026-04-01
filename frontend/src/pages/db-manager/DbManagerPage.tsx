import { useState, useEffect, useCallback } from 'react';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';
import {
  Card, Select, Table, Button, Space, Tag, Modal, Form, Input,
  message, Typography, Tooltip, Popconfirm, Divider, Checkbox, Empty, Tabs, Alert, Spin,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined,
  CopyOutlined, PlayCircleOutlined, ExclamationCircleOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';
import { findFirstHealthyDs } from '../../utils/datasourceHelper';

const { Text, Paragraph } = Typography;

interface Column {
  name: string;
  type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  default_value: string | null;
  comment?: string;
  extra?: string;
}

interface IndexInfo {
  name: string;
  unique: boolean;
  is_primary?: boolean;
  columns: string[];
}

interface TableInfo {
  table_name: string;
  comment?: string | null;
  row_count_estimate?: number | null;
}

interface DatasourceOption {
  id: number;
  datasource_name: string;
  db_type: string;
}

export default function DbManagerPage() {
  const { t } = useTranslation();
  const { onlineStatus } = useDatasourceOnline();
  const [datasources, setDatasources] = useState<DatasourceOption[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [tableComment, setTableComment] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Create table modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [newColumns, setNewColumns] = useState<Array<{
    name: string; type: string; is_primary_key: boolean; is_nullable: boolean;
    default_value: string; comment: string;
  }>>([{ name: '', type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, default_value: '', comment: '' }]);

  // SQL preview
  const [sqlPreview, setSqlPreview] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlExecutable, setSqlExecutable] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<any>) | null>(null);

  // Add column modal
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColForm] = Form.useForm();

  // Modify column modal
  const [modifyColOpen, setModifyColOpen] = useState(false);
  const [modifyColForm] = Form.useForm();
  const [modifyTarget, setModifyTarget] = useState<string>('');

  // Index management
  const [createIdxOpen, setCreateIdxOpen] = useState(false);
  const [createIdxForm] = Form.useForm();
  const [idxLoading, setIdxLoading] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState('structure');

  // Data preview
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: any[]; total_estimate: number | null }>({ columns: [], rows: [], total_estimate: null });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSorter, setPreviewSorter] = useState<{ field?: string; order?: 'ASC' | 'DESC' }>({});

  // DDL export
  const [ddlOpen, setDdlOpen] = useState(false);
  const [ddlContent, setDdlContent] = useState('');
  const [ddlLoading, setDdlLoading] = useState(false);

  // Table rename / comment edit
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm] = Form.useForm();
  const [commentEditOpen, setCommentEditOpen] = useState(false);
  const [commentForm] = Form.useForm();

  // Fetch datasources
  useEffect(() => {
    api.get('/datasource', { params: { page_size: 100 } }).then((res: any) => {
      const raw = res.data;
      const items = Array.isArray(raw) ? raw : (raw?.items || []);
      const mapped = items.map((d: any) => ({
        id: d.id,
        datasource_name: d.datasource_name,
        db_type: d.db_type,
        status: d.status,
        last_test_status: d.last_test_status,
      }));
      setDatasources(mapped);
      if (mapped.length > 0 && !selectedDs) {
        const healthy = findFirstHealthyDs(mapped, onlineStatus);
        if (healthy) setSelectedDs(healthy.id);
      }
    }).catch(() => {});
  }, []);

  // Fetch tables when datasource changes
  const fetchTables = useCallback(async () => {
    if (!selectedDs) return;
    setLoading(true);
    try {
      const res = await api.get('/db-manager/tables', { params: { datasource_id: selectedDs, keyword: tableSearch } });
      setTables(res.data?.tables || []);
      setTotalCount(res.data?.total_count || 0);
    } catch {
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDs, tableSearch]);

  useEffect(() => {
    setSelectedTable(null);
    setColumns([]);
    setIndexes([]);
    setTableSearch('');
    if (selectedDs) fetchTables();
  }, [selectedDs]);

  // Re-fetch when search changes (debounced via useEffect)
  useEffect(() => {
    if (selectedDs) fetchTables();
  }, [tableSearch, fetchTables]);

  // Fetch table structure
  const fetchStructure = useCallback(async () => {
    if (!selectedDs || !selectedTable) return;
    setLoading(true);
    try {
      const res = await api.get('/db-manager/table-structure', {
        params: { datasource_id: selectedDs, table_name: selectedTable },
      });
      setColumns(res.data?.columns || []);
      setIndexes(res.data?.indexes || []);
      setTableComment(res.data?.table_comment || '');
    } catch {
      setColumns([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDs, selectedTable]);

  useEffect(() => {
    if (selectedTable) {
      setDetailTab('structure');
      fetchStructure();
    }
  }, [selectedTable, fetchStructure]);

  // Fetch indexes
  const fetchIndexes = useCallback(async () => {
    if (!selectedDs || !selectedTable) return;
    setIdxLoading(true);
    try {
      const res = await api.get('/db-manager/indexes', {
        params: { datasource_id: selectedDs, table_name: selectedTable },
      });
      setIndexes(res.data?.indexes || []);
    } catch {
      setIndexes([]);
    } finally {
      setIdxLoading(false);
    }
  }, [selectedDs, selectedTable]);

  // Fetch data preview
  const fetchPreview = useCallback(async () => {
    if (!selectedDs || !selectedTable) return;
    setPreviewLoading(true);
    try {
      const params: any = { datasource_id: selectedDs, table_name: selectedTable, limit: 100 };
      if (previewSorter.field) {
        params.order_by = previewSorter.field;
        params.order_dir = previewSorter.order || 'ASC';
      }
      const res = await api.get('/db-manager/table-data', { params });
      setPreviewData({
        columns: res.data?.columns || [],
        rows: res.data?.rows || [],
        total_estimate: res.data?.total_estimate,
      });
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('dbManager.operationFailed'));
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedDs, selectedTable, previewSorter]);

  // Preview SQL then optionally execute
  const showSql = (sql: string, canExecute: boolean, executeAction?: () => Promise<any>) => {
    setSqlPreview(sql);
    setSqlExecutable(canExecute);
    setPendingAction(canExecute && executeAction ? () => executeAction : null);
    setSqlOpen(true);
  };

  // Create table
  const handleCreateTable = async (execute: boolean) => {
    try {
      const values = await createForm.validateFields();
      const validCols = newColumns.filter(c => c.name.trim());
      if (validCols.length === 0) { message.warning(t('dbManager.atLeastOneColumn')); return; }
      const res = await api.post('/db-manager/create-table', {
        datasource_id: selectedDs, table_name: values.table_name,
        columns: validCols, comment: values.comment || null, execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || t('dbManager.tableCreated'));
        setCreateOpen(false); createForm.resetFields();
        setNewColumns([{ name: '', type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, default_value: '', comment: '' }]);
        fetchTables();
      } else if (execute && res.data?.error) {
        message.error(res.data.error);
      } else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/create-table', {
            datasource_id: selectedDs, table_name: values.table_name,
            columns: validCols, comment: values.comment || null, execute: true,
          });
          if (execRes.data?.executed) { message.success(t('dbManager.tableCreated')); setCreateOpen(false); fetchTables(); }
          else if (execRes.data?.error) { message.error(execRes.data.error); }
        });
      }
    } catch { /* validation */ }
  };

  // Add column
  const handleAddColumn = async (execute: boolean) => {
    try {
      const values = await addColForm.validateFields();
      const res = await api.post('/db-manager/add-column', {
        datasource_id: selectedDs, table_name: selectedTable,
        column: { name: values.name, type: values.type, is_primary_key: false, is_nullable: values.is_nullable ?? true, default_value: values.default_value || null, comment: values.comment || null },
        after_column: values.after_column || null, execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || t('dbManager.columnAdded'));
        setAddColOpen(false); addColForm.resetFields(); fetchStructure();
      } else if (execute && res.data?.error) { message.error(res.data.error); }
      else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/add-column', {
            datasource_id: selectedDs, table_name: selectedTable,
            column: { name: values.name, type: values.type, is_nullable: values.is_nullable ?? true, default_value: values.default_value || null, comment: values.comment || null },
            execute: true,
          });
          if (execRes.data?.executed) { message.success(t('dbManager.columnAdded')); setAddColOpen(false); fetchStructure(); }
        });
      }
    } catch { /* validation */ }
  };

  // Drop column
  const handleDropColumn = async (colName: string) => {
    try {
      const res = await api.post('/db-manager/drop-column', {
        datasource_id: selectedDs, table_name: selectedTable, column_name: colName, execute: true,
      });
      if (res.data?.executed) { message.success(res.data.message || t('dbManager.columnDropped')); fetchStructure(); }
      else if (res.data?.error) { message.error(res.data.error); }
    } catch (e: any) { message.error(e?.response?.data?.detail || t('dbManager.operationFailed')); }
  };

  // Modify column
  const handleModifyColumn = async (execute: boolean) => {
    try {
      const values = await modifyColForm.validateFields();
      const res = await api.post('/db-manager/modify-column', {
        datasource_id: selectedDs, table_name: selectedTable, column_name: modifyTarget,
        new_type: values.new_type || null, new_name: values.new_name || null, new_comment: values.new_comment || null, execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || t('dbManager.columnModified'));
        setModifyColOpen(false); modifyColForm.resetFields(); fetchStructure();
      } else if (execute && res.data?.error) { message.error(res.data.error); }
      else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/modify-column', {
            datasource_id: selectedDs, table_name: selectedTable, column_name: modifyTarget,
            new_type: values.new_type || null, new_name: values.new_name || null, new_comment: values.new_comment || null, execute: true,
          });
          if (execRes.data?.executed) { message.success(t('dbManager.columnModified')); setModifyColOpen(false); fetchStructure(); }
        });
      }
    } catch { /* validation */ }
  };

  // Create index
  const handleCreateIndex = async (execute: boolean) => {
    try {
      const values = await createIdxForm.validateFields();
      const res = await api.post('/db-manager/create-index', {
        datasource_id: selectedDs, table_name: selectedTable,
        index_name: values.index_name, columns: values.columns, unique: values.unique ?? false, execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || t('dbManager.indexCreated'));
        setCreateIdxOpen(false); createIdxForm.resetFields(); fetchIndexes();
      } else if (execute && res.data?.error) { message.error(res.data.error); }
      else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/create-index', {
            datasource_id: selectedDs, table_name: selectedTable,
            index_name: values.index_name, columns: values.columns, unique: values.unique ?? false, execute: true,
          });
          if (execRes.data?.executed) { message.success(t('dbManager.indexCreated')); setCreateIdxOpen(false); createIdxForm.resetFields(); fetchIndexes(); }
          else if (execRes.data?.error) { message.error(execRes.data.error); }
        });
      }
    } catch { /* validation */ }
  };

  // Drop index
  const handleDropIndex = async (indexName: string) => {
    try {
      const res = await api.post('/db-manager/drop-index', {
        datasource_id: selectedDs, table_name: selectedTable, index_name: indexName, execute: true,
      });
      if (res.data?.executed) { message.success(res.data.message || t('dbManager.indexDropped')); fetchIndexes(); }
      else if (res.data?.error) { message.error(res.data.error); }
    } catch (e: any) { message.error(e?.response?.data?.detail || t('dbManager.operationFailed')); }
  };

  // Drop table
  const handleDropTable = async () => {
    if (!selectedTable || !selectedDs) return;
    try {
      const res = await api.post('/db-manager/drop-table', {
        datasource_id: selectedDs, table_name: selectedTable, confirm: true, backup_first: true,
      });
      if (res.data?.executed) {
        message.success(res.data.message || t('dbManager.tableDropped'));
        setSelectedTable(null); setColumns([]); fetchTables();
      }
    } catch (e: any) { message.error(e?.response?.data?.detail || t('dbManager.operationFailed')); }
  };

  // Export DDL
  const handleExportDDL = async () => {
    if (!selectedDs || !selectedTable) return;
    setDdlLoading(true);
    try {
      const res = await api.get('/db-manager/export-ddl', {
        params: { datasource_id: selectedDs, table_name: selectedTable, include_indexes: true },
      });
      setDdlContent(res.data?.ddl || '');
      setDdlOpen(true);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('dbManager.operationFailed'));
    } finally {
      setDdlLoading(false);
    }
  };

  // Rename table
  const handleRenameTable = async () => {
    try {
      const values = await renameForm.validateFields();
      const res = await api.post('/db-manager/rename-table', {
        datasource_id: selectedDs, old_name: selectedTable, new_name: values.new_name, execute: true,
      });
      if (res.data?.executed) {
        message.success(res.data.message);
        setRenameOpen(false); renameForm.resetFields();
        setSelectedTable(values.new_name);
        fetchTables();
      } else if (res.data?.error) { message.error(res.data.error); }
    } catch { /* validation */ }
  };

  // Update table comment
  const handleUpdateComment = async () => {
    try {
      const values = await commentForm.validateFields();
      const res = await api.post('/db-manager/update-table-comment', {
        datasource_id: selectedDs, table_name: selectedTable, comment: values.comment, execute: true,
      });
      if (res.data?.executed) {
        message.success(res.data.message);
        setCommentEditOpen(false); commentForm.resetFields();
        setTableComment(values.comment);
      } else if (res.data?.error) { message.error(res.data.error); }
      else if (res.data?.message) { message.info(res.data.message); setCommentEditOpen(false); }
    } catch { /* validation */ }
  };

  const addNewColumnRow = () => {
    setNewColumns([...newColumns, { name: '', type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, default_value: '', comment: '' }]);
  };
  const removeNewColumnRow = (index: number) => {
    setNewColumns(newColumns.filter((_, i) => i !== index));
  };
  const updateNewColumn = (index: number, field: string, value: any) => {
    const updated = [...newColumns];
    (updated[index] as any)[field] = value;
    setNewColumns(updated);
  };
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success(t('dbManager.copied')));
  };
  const downloadSql = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const structureColumns = [
    { title: t('dbManager.columnName'), dataIndex: 'name', key: 'name', width: 180 },
    { title: t('dbManager.columnType'), dataIndex: 'type', key: 'type', width: 160 },
    {
      title: t('dbManager.primaryKey'), dataIndex: 'is_primary_key', key: 'pk', width: 70,
      render: (v: boolean) => v ? <Tag color="blue">PK</Tag> : null,
    },
    {
      title: t('dbManager.nullable'), dataIndex: 'is_nullable', key: 'nullable', width: 70,
      render: (v: boolean) => v ? <Tag>YES</Tag> : <Tag color="red">NO</Tag>,
    },
    { title: t('dbManager.defaultValue'), dataIndex: 'default_value', key: 'default', width: 130, ellipsis: true },
    { title: t('dbManager.comment'), dataIndex: 'comment', key: 'comment', width: 180, ellipsis: true },
    {
      title: t('common.operation'), key: 'action', width: 120,
      render: (_: any, record: Column) => (
        <Space size="small">
          <Tooltip title={t('dbManager.modifyColumn')}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => {
              setModifyTarget(record.name);
              modifyColForm.setFieldsValue({ new_type: record.type, new_name: record.name, new_comment: record.comment || '' });
              setModifyColOpen(true);
            }} />
          </Tooltip>
          <Popconfirm title={t('dbManager.confirmDropColumn', { name: record.name })} onConfirm={() => handleDropColumn(record.name)} icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Filtered tables (client-side filter on top of server-side)
  const filteredTables = tables;

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 140px)', minHeight: 500 }}>
      {/* Left Panel - Table List */}
      <Card
        size="small"
        style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        bodyStyle={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
      >
        <Select
          placeholder={t('dbManager.selectDatasource')}
          style={{ width: '100%', marginBottom: 8 }}
          value={selectedDs}
          onChange={v => setSelectedDs(v)}
          options={datasources.map(d => {
            const offline = onlineStatus[String(d.id)] === false;
            return { value: d.id, label: `${d.datasource_name} (${d.db_type})${offline ? ' ⚠ 离线' : ''}`, disabled: offline };
          })}
          showSearch
          filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
          size="small"
        />
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('dbManager.searchTable')}
          value={tableSearch}
          onChange={e => setTableSearch(e.target.value)}
          allowClear
          size="small"
          style={{ marginBottom: 8 }}
        />
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
          {tableSearch
            ? t('dbManager.tableCountFiltered', { filtered: filteredTables.length, total: totalCount })
            : t('dbManager.tableCount', { count: totalCount })}
        </div>
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 8 }}>
          {loading && !filteredTables.length ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
          ) : filteredTables.length === 0 ? (
            <Empty description={t('dbManager.noTables')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            filteredTables.map(tbl => (
              <div
                key={tbl.table_name}
                onClick={() => setSelectedTable(tbl.table_name)}
                style={{
                  padding: '6px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  marginBottom: 2,
                  background: selectedTable === tbl.table_name ? '#e6f4ff' : 'transparent',
                  borderLeft: selectedTable === tbl.table_name ? '3px solid #1677ff' : '3px solid transparent',
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${tbl.table_name}${tbl.comment ? ` — ${tbl.comment}` : ''}${tbl.row_count_estimate != null ? ` (~${tbl.row_count_estimate} rows)` : ''}`}
              >
                <Text ellipsis style={{ fontSize: 13 }}>{tbl.table_name}</Text>
                {tbl.row_count_estimate != null && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>~{tbl.row_count_estimate?.toLocaleString()}</Text>
                )}
                {tbl.comment && (
                  <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tbl.comment}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <Space style={{ flexShrink: 0 }}>
          <Button size="small" icon={<PlusOutlined />} type="primary" disabled={!selectedDs} onClick={() => setCreateOpen(true)}>
            {t('dbManager.createTable')}
          </Button>
          <Button size="small" icon={<ReloadOutlined />} disabled={!selectedDs} onClick={fetchTables}>
            {t('dbManager.refresh')}
          </Button>
        </Space>
      </Card>

      {/* Right Panel - Table Detail */}
      <Card
        size="small"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        bodyStyle={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
      >
        {!selectedTable ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description={t('dbManager.selectTableHint')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 16 }}>{selectedTable}</Text>
              <Tooltip title={t('dbManager.renameTable')}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { renameForm.setFieldsValue({ new_name: selectedTable }); setRenameOpen(true); }} />
              </Tooltip>
              {tableComment && <Text type="secondary">-- {tableComment}</Text>}
              <Tooltip title={t('dbManager.editComment')}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { commentForm.setFieldsValue({ comment: tableComment }); setCommentEditOpen(true); }} />
              </Tooltip>
              <div style={{ flex: 1 }} />
              <Button size="small" icon={<DownloadOutlined />} loading={ddlLoading} onClick={handleExportDDL}>
                {t('dbManager.exportDDL')}
              </Button>
              <Popconfirm title={t('dbManager.confirmDrop', { name: selectedTable })} onConfirm={handleDropTable} okType="danger"
                icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}>
                <Button size="small" danger icon={<DeleteOutlined />}>{t('dbManager.dropTable')}</Button>
              </Popconfirm>
            </div>

            {/* Tabs */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Tabs activeKey={detailTab} onChange={(k) => {
                setDetailTab(k);
                if (k === 'indexes') fetchIndexes();
                if (k === 'data') fetchPreview();
              }} items={[
                {
                  key: 'structure',
                  label: t('dbManager.tableStructure'),
                  children: (
                    <>
                      <Space style={{ marginBottom: 8 }}>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => { addColForm.resetFields(); setAddColOpen(true); }}>
                          {t('dbManager.addColumn')}
                        </Button>
                      </Space>
                      <Table columns={structureColumns} dataSource={columns} rowKey="name" loading={loading} size="small" pagination={false} scroll={{ y: 'calc(100vh - 360px)' }} />
                    </>
                  ),
                },
                {
                  key: 'indexes',
                  label: t('dbManager.indexes'),
                  children: (
                    <>
                      <Space style={{ marginBottom: 8 }}>
                        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { createIdxForm.resetFields(); setCreateIdxOpen(true); }}>
                          {t('dbManager.createIndex')}
                        </Button>
                      </Space>
                      <Table
                        size="small" pagination={false} loading={idxLoading} dataSource={indexes} rowKey="name"
                        columns={[
                          { title: t('dbManager.indexName'), dataIndex: 'name', key: 'name', width: 220 },
                          {
                            title: t('dbManager.indexType'), dataIndex: 'unique', key: 'unique', width: 110,
                            render: (v: boolean, record: IndexInfo) =>
                              record.is_primary ? <Tag color="blue">PRIMARY</Tag> :
                              v ? <Tag color="green">UNIQUE</Tag> : <Tag>INDEX</Tag>,
                          },
                          { title: t('dbManager.indexColumns'), dataIndex: 'columns', key: 'columns', render: (v: string[]) => v?.join(', ') },
                          {
                            title: t('common.operation'), key: 'action', width: 90,
                            render: (_: unknown, record: IndexInfo) => (
                              record.is_primary ? null : (
                                <Popconfirm title={t('dbManager.confirmDropIndex', { name: record.name })}
                                  icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
                                  onConfirm={() => handleDropIndex(record.name)}>
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              )
                            ),
                          },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'data',
                  label: t('dbManager.dataPreview'),
                  children: previewLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : (
                    <>
                      {previewData.total_estimate != null && (
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                          {t('dbManager.previewHint', { total: previewData.total_estimate?.toLocaleString() || '?', count: previewData.rows.length })}
                        </div>
                      )}
                      <Table
                        size="small"
                        dataSource={previewData.rows}
                        rowKey={(_, i) => String(i)}
                        pagination={false}
                        scroll={{ x: 'max-content', y: 'calc(100vh - 380px)' }}
                        onChange={(_p, _f, sorter: any) => {
                          if (sorter?.field) {
                            setPreviewSorter({ field: sorter.field, order: sorter.order === 'descend' ? 'DESC' : 'ASC' });
                          } else {
                            setPreviewSorter({});
                          }
                        }}
                        columns={previewData.columns.map(col => ({
                          title: col, dataIndex: col, key: col, width: 150, ellipsis: true,
                          sorter: true,
                          render: (v: any) => v == null ? <Text type="secondary" italic>NULL</Text> : String(v),
                        }))}
                      />
                    </>
                  ),
                },
              ]} />
            </div>
          </>
        )}
      </Card>

      {/* Create Table Modal */}
      <Modal title={t('dbManager.createTable')} open={createOpen} onCancel={() => setCreateOpen(false)} width={900}
        footer={[
          <Button key="cancel" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleCreateTable(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleCreateTable(true)}>{t('dbManager.execute')}</Button>,
        ]}>
        <Form form={createForm} layout="vertical">
          <Space style={{ width: '100%' }}>
            <Form.Item name="table_name" label={t('dbManager.tableName')} rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="new_table" />
            </Form.Item>
            <Form.Item name="comment" label={t('dbManager.tableComment')} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
        </Form>
        <Divider style={{ margin: '8px 0' }}>{t('dbManager.columnDefs')}</Divider>
        {newColumns.map((col, i) => (
          <Space key={i} style={{ display: 'flex', marginBottom: 6, alignItems: 'center' }} wrap>
            <Input placeholder={t('dbManager.columnName')} value={col.name} onChange={e => updateNewColumn(i, 'name', e.target.value)} style={{ width: 130 }} size="small" />
            <Input placeholder={t('dbManager.columnType')} value={col.type} onChange={e => updateNewColumn(i, 'type', e.target.value)} style={{ width: 140 }} size="small" />
            <Checkbox checked={col.is_primary_key} onChange={e => updateNewColumn(i, 'is_primary_key', e.target.checked)}>PK</Checkbox>
            <Checkbox checked={col.is_nullable} onChange={e => updateNewColumn(i, 'is_nullable', e.target.checked)}>NULL</Checkbox>
            <Input placeholder={t('dbManager.defaultValue')} value={col.default_value} onChange={e => updateNewColumn(i, 'default_value', e.target.value)} style={{ width: 110 }} size="small" />
            <Input placeholder={t('dbManager.comment')} value={col.comment} onChange={e => updateNewColumn(i, 'comment', e.target.value)} style={{ width: 130 }} size="small" />
            <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => removeNewColumnRow(i)} disabled={newColumns.length <= 1} />
          </Space>
        ))}
        <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addNewColumnRow} style={{ width: '100%' }}>{t('dbManager.addColumn')}</Button>
      </Modal>

      {/* Add Column Modal */}
      <Modal title={t('dbManager.addColumn')} open={addColOpen} onCancel={() => setAddColOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAddColOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleAddColumn(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleAddColumn(true)}>{t('dbManager.execute')}</Button>,
        ]}>
        <Form form={addColForm} layout="vertical">
          <Form.Item name="name" label={t('dbManager.columnName')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label={t('dbManager.columnType')} rules={[{ required: true }]}><Input placeholder="VARCHAR(255)" /></Form.Item>
          <Form.Item name="is_nullable" valuePropName="checked" initialValue={true}><Checkbox>{t('dbManager.nullable')}</Checkbox></Form.Item>
          <Form.Item name="default_value" label={t('dbManager.defaultValue')}><Input /></Form.Item>
          <Form.Item name="comment" label={t('dbManager.comment')}><Input /></Form.Item>
          <Form.Item name="after_column" label={t('dbManager.afterColumn')}>
            <Select allowClear placeholder={t('dbManager.afterColumnEnd')} options={columns.map(c => ({ value: c.name, label: c.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modify Column Modal */}
      <Modal title={`${t('dbManager.modifyColumn')}: ${modifyTarget}`} open={modifyColOpen} onCancel={() => setModifyColOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setModifyColOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleModifyColumn(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleModifyColumn(true)}>{t('dbManager.execute')}</Button>,
        ]}>
        <Alert message={t('dbManager.ddlWarning')} type="warning" showIcon style={{ marginBottom: 12 }} />
        <Form form={modifyColForm} layout="vertical">
          <Form.Item name="new_name" label={t('dbManager.newColumnName')}><Input /></Form.Item>
          <Form.Item name="new_type" label={t('dbManager.newColumnType')}><Input /></Form.Item>
          <Form.Item name="new_comment" label={t('dbManager.comment')}><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Create Index Modal */}
      <Modal title={t('dbManager.createIndex')} open={createIdxOpen} onCancel={() => setCreateIdxOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setCreateIdxOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleCreateIndex(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleCreateIndex(true)}>{t('dbManager.execute')}</Button>,
        ]}>
        <Form form={createIdxForm} layout="vertical">
          <Form.Item name="index_name" label={t('dbManager.indexName')} rules={[{ required: true, message: t('dbManager.indexNameRequired') }]}>
            <Input placeholder="idx_table_column" />
          </Form.Item>
          <Form.Item name="columns" label={t('dbManager.indexColumns')} rules={[{ required: true, message: t('dbManager.indexColumnsRequired') }]}>
            <Select mode="multiple" placeholder={t('dbManager.selectColumns')} options={columns.map(c => ({ value: c.name, label: c.name }))} />
          </Form.Item>
          <Form.Item name="unique" valuePropName="checked" initialValue={false}>
            <Checkbox>{t('dbManager.uniqueIndex')}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* Rename Table Modal */}
      <Modal title={t('dbManager.renameTable')} open={renameOpen} onOk={handleRenameTable} onCancel={() => setRenameOpen(false)}>
        <Alert message={t('dbManager.ddlWarning')} type="warning" showIcon style={{ marginBottom: 12 }} />
        <Form form={renameForm} layout="vertical">
          <Form.Item name="new_name" label={t('dbManager.newTableName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Comment Modal */}
      <Modal title={t('dbManager.editComment')} open={commentEditOpen} onOk={handleUpdateComment} onCancel={() => setCommentEditOpen(false)}>
        <Form form={commentForm} layout="vertical">
          <Form.Item name="comment" label={t('dbManager.tableComment')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* DDL Export Modal */}
      <Modal title={t('dbManager.exportDDL')} open={ddlOpen} onCancel={() => setDdlOpen(false)} width={700}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => copyToClipboard(ddlContent)}>{t('dbManager.copyDDL')}</Button>,
          <Button key="download" icon={<DownloadOutlined />} onClick={() => downloadSql(ddlContent, `${selectedTable}.sql`)}>{t('dbManager.downloadSql')}</Button>,
          <Button key="close" onClick={() => setDdlOpen(false)}>{t('common.close')}</Button>,
        ]}>
        <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, maxHeight: 400, overflow: 'auto', fontSize: 13, whiteSpace: 'pre-wrap' }}>
          {ddlContent}
        </pre>
      </Modal>

      {/* SQL Preview Modal */}
      <Modal title={t('dbManager.sqlPreview')} open={sqlOpen} onCancel={() => setSqlOpen(false)} width={700}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => copyToClipboard(sqlPreview)}>{t('dbManager.copied')}</Button>,
          <Button key="close" onClick={() => setSqlOpen(false)}>{t('common.close')}</Button>,
          ...(sqlExecutable && pendingAction ? [
            <Button key="exec" type="primary" icon={<PlayCircleOutlined />} onClick={async () => {
              if (pendingAction) { await pendingAction(); setSqlOpen(false); }
            }}>{t('dbManager.execute')}</Button>,
          ] : []),
        ]}>
        <Paragraph>
          <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, maxHeight: 400, overflow: 'auto', fontSize: 13 }}>
            {sqlPreview}
          </pre>
        </Paragraph>
      </Modal>
    </div>
  );
}
