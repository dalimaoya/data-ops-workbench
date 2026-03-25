import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Select, Table, Input, Button, Checkbox, Space, Progress, Tag, message,
  Typography, Tooltip, Steps, Divider, Radio, Result, Spin,
  Alert,
} from 'antd';
import {
  SearchOutlined, RocketOutlined, CheckCircleOutlined,
  LeftOutlined, RightOutlined, DownloadOutlined, DatabaseOutlined,
  ReloadOutlined, CheckOutlined, EyeOutlined, EditOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { listDatasources, type Datasource } from '../../api/datasource';
import { getRemoteTables, listTableConfigs, type RemoteTableInfo, type TableConfig } from '../../api/tableConfig';
import {
  batchManageTables, batchConfirm, batchExport,
  type BatchTableResult,
  type TableConfirmItem,
} from '../../api/batchManage';

const { Title, Text } = Typography;

interface TableSelectItem extends RemoteTableInfo {
  is_managed: boolean;
  field_count?: number;
  table_config_id?: number;
}

// Table config for confirmation editing
interface EditableTableConfig {
  table_name: string;
  display_name: string;
  primary_key: string;
  confirmed: boolean;
  fields: EditableFieldConfig[];
  ai_suggestions: Record<string, any[]>;
}

interface EditableFieldConfig {
  field_name: string;
  field_alias: string;
  db_data_type: string;
  field_order_no: number;
  is_primary_key: number;
  is_editable: number;
  is_required: number;
  is_system_field: number;
  is_displayed: number;
  include_in_export: number;
  include_in_import: number;
  enum_options_json?: string;
  sample_value?: string;
  ai_source?: string;
}

export default function DatabaseMaintenance() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Step management
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: datasource + table selection
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedDsId, setSelectedDsId] = useState<number | undefined>();
  const [remoteTables, setRemoteTables] = useState<TableSelectItem[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedTableNames, setSelectedTableNames] = useState<string[]>([]);

  // Step 2: batch processing
  const [, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [, setBatchResults] = useState<BatchTableResult[]>([]);

  // Step 3: config confirmation
  const [editableTables, setEditableTables] = useState<EditableTableConfig[]>([]);
  const [currentTableIdx, setCurrentTableIdx] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);

  // Step 4: saving
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<any>(null);

  // Error state for table loading
  const [tableLoadError, setTableLoadError] = useState<string | null>(null);

  // Managed tables tab
  const [activeTab, setActiveTab] = useState<'batch' | 'managed'>('batch');
  const [managedTables, setManagedTables] = useState<TableConfig[]>([]);
  const [managedSelectedIds, setManagedSelectedIds] = useState<number[]>([]);
  const [exportFormat, setExportFormat] = useState<string>('zip');
  const [exporting, setExporting] = useState(false);

  // Load datasources
  useEffect(() => {
    listDatasources({ status: 'enabled' }).then(res => {
      setDatasources(res.data);
    }).catch(() => {});
  }, []);

  // Load remote tables + managed info when datasource changes
  const loadTables = useCallback(async (dsId: number) => {
    setLoadingTables(true);
    setRemoteTables([]);
    setSelectedTableNames([]);
    setTableLoadError(null);
    try {
      const [remoteRes, managedRes] = await Promise.all([
        getRemoteTables(dsId),
        listTableConfigs({ datasource_id: dsId, page_size: 500 }),
      ]);

      const managedMap = new Map<string, TableConfig>();
      (managedRes.data as TableConfig[]).forEach(tc => {
        managedMap.set(tc.table_name, tc);
      });
      setManagedTables(managedRes.data as TableConfig[]);

      const items: TableSelectItem[] = remoteRes.data.tables.map(rt => {
        const managed = managedMap.get(rt.table_name);
        return {
          ...rt,
          is_managed: !!managed,
          table_config_id: managed?.id,
          field_count: managed?.field_count,
        };
      });
      setRemoteTables(items);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || t('tableConfig.getTablesFailed');
      setTableLoadError(detail);
      message.error(detail);
    } finally {
      setLoadingTables(false);
    }
  }, [t]);

  useEffect(() => {
    if (selectedDsId) {
      loadTables(selectedDsId);
    }
  }, [selectedDsId, loadTables]);

  // Filtered tables
  const filteredTables = useMemo(() => {
    if (!searchText) return remoteTables;
    const lower = searchText.toLowerCase();
    return remoteTables.filter(rt => rt.table_name.toLowerCase().includes(lower));
  }, [remoteTables, searchText]);

  const unmanagedTables = useMemo(() => filteredTables.filter(t => !t.is_managed), [filteredTables]);
  // unmanagedTableNames removed — not needed currently

  // Select all/none
  const handleSelectAll = () => {
    setSelectedTableNames(unmanagedTables.map(t => t.table_name));
  };
  const handleDeselectAll = () => {
    setSelectedTableNames([]);
  };
  const handleInvertSelection = () => {
    setSelectedTableNames(prev => {
      const prevSet = new Set(prev);
      return unmanagedTables
        .filter(t => !prevSet.has(t.table_name))
        .map(t => t.table_name);
    });
  };

  // Step 2: Start batch processing
  const handleStartBatch = async () => {
    if (!selectedDsId || selectedTableNames.length === 0) return;

    setCurrentStep(1);
    setProcessing(true);
    setTotalToProcess(selectedTableNames.length);
    setProcessedCount(0);
    setBatchResults([]);

    try {
      // Process in one API call (backend handles all tables)
      const res = await batchManageTables({
        datasource_id: selectedDsId,
        table_names: selectedTableNames,
        auto_ai_suggest: true,
        sample_count: 50,
      });

      const data = (res.data as any).data || res.data;
      const results = data.results || [];
      setBatchResults(results);
      setProcessedCount(results.length);

      // Convert to editable configs
      const editables: EditableTableConfig[] = results
        .filter((r: BatchTableResult) => r.status === 'success')
        .map((r: BatchTableResult) => {
          const fields: EditableFieldConfig[] = r.fields.map(f => {
            // Apply AI suggestions for field alias
            let alias = f.field_name;
            let aiSource = '';
            const suggestions = r.ai_suggestions?.[f.field_name] || [];
            const dnSuggestion = suggestions.find((s: any) => s.property === 'display_name');
            if (dnSuggestion) {
              alias = dnSuggestion.value;
              aiSource = '🤖AI';
            }

            return {
              field_name: f.field_name,
              field_alias: alias,
              db_data_type: f.db_data_type,
              field_order_no: f.field_order_no,
              is_primary_key: f.is_primary_key,
              is_editable: f.is_editable,
              is_required: f.is_required,
              is_system_field: f.is_system_field,
              is_displayed: f.is_displayed,
              include_in_export: f.include_in_export,
              include_in_import: f.include_in_import,
              sample_value: f.sample_value,
              ai_source: aiSource,
            };
          });

          return {
            table_name: r.table_name,
            display_name: r.table_display_name || r.table_name,
            primary_key: r.primary_key || '',
            confirmed: false,
            fields,
            ai_suggestions: r.ai_suggestions || {},
          };
        });

      setEditableTables(editables);
      setCurrentTableIdx(0);
      setConfirmedCount(0);

      // Move to step 3
      setTimeout(() => {
        setProcessing(false);
        if (editables.length > 0) {
          setCurrentStep(2);
        }
      }, 500);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '批量纳管失败');
      setProcessing(false);
      setCurrentStep(0);
    }
  };

  // Step 3: Confirm current table
  const handleConfirmCurrent = () => {
    setEditableTables(prev => {
      const next = [...prev];
      next[currentTableIdx] = { ...next[currentTableIdx], confirmed: true };
      return next;
    });
    setConfirmedCount(prev => prev + 1);

    // Move to next unconfirmed
    if (currentTableIdx < editableTables.length - 1) {
      setCurrentTableIdx(currentTableIdx + 1);
    }
  };

  const handleConfirmAll = () => {
    setEditableTables(prev => prev.map(t => ({ ...t, confirmed: true })));
    setConfirmedCount(editableTables.length);
  };

  // Step 4: Save
  const handleBatchSave = async () => {
    if (!selectedDsId) return;

    setSaving(true);
    setCurrentStep(3);

    const tables: TableConfirmItem[] = editableTables.map(et => ({
      table_name: et.table_name,
      display_name: et.display_name,
      primary_key: et.primary_key,
      fields: et.fields.map(f => ({
        field_name: f.field_name,
        field_alias: f.field_alias,
        db_data_type: f.db_data_type,
        field_order_no: f.field_order_no,
        is_primary_key: f.is_primary_key,
        is_editable: f.is_editable,
        is_required: f.is_required,
        is_system_field: f.is_system_field,
        is_displayed: f.is_displayed,
        include_in_export: f.include_in_export,
        include_in_import: f.include_in_import,
        sample_value: f.sample_value,
      })),
    }));

    try {
      const res = await batchConfirm({
        datasource_id: selectedDsId,
        tables,
      });
      const data = (res.data as any).data || res.data;
      setSaveResult(data);
      message.success(`成功纳管 ${data.created} 张表`);
      // Refresh managed tables
      if (selectedDsId) loadTables(selectedDsId);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '批量保存失败');
      setSaveResult({ error: true });
    } finally {
      setSaving(false);
    }
  };

  // Reset to start
  const handleReset = () => {
    setCurrentStep(0);
    setSelectedTableNames([]);
    setBatchResults([]);
    setEditableTables([]);
    setCurrentTableIdx(0);
    setConfirmedCount(0);
    setSaveResult(null);
    if (selectedDsId) loadTables(selectedDsId);
  };

  // Batch export
  const handleBatchExport = async () => {
    if (!selectedDsId || managedSelectedIds.length === 0) {
      message.warning(t('maintenance.batchExportEmpty'));
      return;
    }
    setExporting(true);
    try {
      const res = await batchExport({
        datasource_id: selectedDsId,
        table_ids: managedSelectedIds,
        format: exportFormat,
      });
      // Download blob
      const blob = new Blob([res.data as any]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = exportFormat === 'zip' ? 'zip' : 'xlsx';
      a.download = `batch_export_${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success(t('maintenance.batchExportSuccess', { count: managedSelectedIds.length }));
    } catch {
      message.error(t('maintenance.batchExportFailed'));
    } finally {
      setExporting(false);
    }
  };

  // Update field in current table
  const updateField = (fieldIdx: number, key: string, value: any) => {
    setEditableTables(prev => {
      const next = [...prev];
      const table = { ...next[currentTableIdx] };
      const fields = [...table.fields];
      fields[fieldIdx] = { ...fields[fieldIdx], [key]: value };
      table.fields = fields;
      next[currentTableIdx] = table;
      return next;
    });
  };

  const updateTableDisplayName = (value: string) => {
    setEditableTables(prev => {
      const next = [...prev];
      next[currentTableIdx] = { ...next[currentTableIdx], display_name: value };
      return next;
    });
  };

  const updateTablePrimaryKey = (value: string) => {
    setEditableTables(prev => {
      const next = [...prev];
      next[currentTableIdx] = { ...next[currentTableIdx], primary_key: value };
      return next;
    });
  };

  const currentTable = editableTables[currentTableIdx];
  const allConfirmed = editableTables.length > 0 && editableTables.every(t => t.confirmed);

  // ── Table selection columns ──
  const tableSelectColumns = [
    {
      title: '',
      dataIndex: 'select',
      width: 50,
      render: (_: any, record: TableSelectItem) => (
        record.is_managed ? (
          <Tooltip title={t('dbMaintenance.alreadyManaged')}>
            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
          </Tooltip>
        ) : (
          <Checkbox
            checked={selectedTableNames.includes(record.table_name)}
            onChange={e => {
              if (e.target.checked) {
                setSelectedTableNames(prev => [...prev, record.table_name]);
              } else {
                setSelectedTableNames(prev => prev.filter(n => n !== record.table_name));
              }
            }}
          />
        )
      ),
    },
    {
      title: t('common.tableName'),
      dataIndex: 'table_name',
      ellipsis: true,
      render: (val: string, record: TableSelectItem) => (
        record.is_managed && record.table_config_id ? (
          <a onClick={() => navigate(`/data-maintenance/browse/${record.table_config_id}`)}
             style={{ cursor: 'pointer' }}>
            {val}
          </a>
        ) : val
      ),
    },
    {
      title: t('dbMaintenance.fieldCount'),
      dataIndex: 'field_count',
      width: 80,
      render: (val: number | undefined) => val ?? '—',
    },
    {
      title: t('common.status'),
      dataIndex: 'is_managed',
      width: 100,
      render: (val: boolean) => val
        ? <Tag color="success">{t('dbMaintenance.managed')}</Tag>
        : <Tag>{t('dbMaintenance.unmanaged')}</Tag>,
    },
    {
      title: t('common.actions'),
      width: 120,
      render: (_: any, record: TableSelectItem) => record.is_managed && record.table_config_id ? (
        <Space size="small">
          <Tooltip title={t('maintenance.browse')}>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/data-maintenance/browse/${record.table_config_id}`)}
            />
          </Tooltip>
          <Tooltip title={t('maintenance.import')}>
            <Button
              type="link"
              size="small"
              icon={<ImportOutlined />}
              onClick={() => navigate(`/data-maintenance/import/${record.table_config_id}`)}
            />
          </Tooltip>
        </Space>
      ) : null,
    },
  ];

  // ── Field config columns for Step 3 ──
  const fieldColumns = [
    {
      title: '#',
      dataIndex: 'field_order_no',
      width: 40,
      render: (_: any, __: any, idx: number) => idx + 1,
    },
    {
      title: t('fieldConfig.fieldName'),
      dataIndex: 'field_name',
      width: 160,
      ellipsis: true,
    },
    {
      title: t('fieldConfig.dbType'),
      dataIndex: 'db_data_type',
      width: 100,
      ellipsis: true,
    },
    {
      title: t('fieldConfig.alias'),
      dataIndex: 'field_alias',
      width: 160,
      render: (val: string, _: any, idx: number) => (
        <Input
          size="small"
          value={val}
          onChange={e => updateField(idx, 'field_alias', e.target.value)}
          suffix={currentTable?.fields[idx]?.ai_source ? (
            <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              {currentTable.fields[idx].ai_source}
            </Tag>
          ) : null}
        />
      ),
    },
    {
      title: t('fieldConfig.editable'),
      dataIndex: 'is_editable',
      width: 70,
      align: 'center' as const,
      render: (val: number, _: any, idx: number) => (
        <Checkbox
          checked={val === 1}
          onChange={e => updateField(idx, 'is_editable', e.target.checked ? 1 : 0)}
        />
      ),
    },
    {
      title: t('fieldConfig.primaryKey'),
      dataIndex: 'is_primary_key',
      width: 60,
      align: 'center' as const,
      render: (val: number) => val ? <Tag color="gold">PK</Tag> : null,
    },
    {
      title: t('fieldConfig.systemField'),
      dataIndex: 'is_system_field',
      width: 70,
      align: 'center' as const,
      render: (val: number, _: any, idx: number) => (
        <Checkbox
          checked={val === 1}
          onChange={e => updateField(idx, 'is_system_field', e.target.checked ? 1 : 0)}
        />
      ),
    },
    {
      title: t('fieldConfig.displayed'),
      dataIndex: 'is_displayed',
      width: 60,
      align: 'center' as const,
      render: (val: number, _: any, idx: number) => (
        <Checkbox
          checked={val === 1}
          onChange={e => updateField(idx, 'is_displayed', e.target.checked ? 1 : 0)}
        />
      ),
    },
    {
      title: t('fieldConfig.sampleValue'),
      dataIndex: 'sample_value',
      width: 120,
      ellipsis: true,
      render: (val: string | undefined) => val || '—',
    },
  ];

  // ── Managed tables columns ──
  const managedColumns = [
    {
      title: '',
      width: 50,
      render: (_: any, record: TableConfig) => (
        <Checkbox
          checked={managedSelectedIds.includes(record.id)}
          onChange={e => {
            if (e.target.checked) {
              setManagedSelectedIds(prev => [...prev, record.id]);
            } else {
              setManagedSelectedIds(prev => prev.filter(id => id !== record.id));
            }
          }}
        />
      ),
    },
    {
      title: t('common.tableName'),
      dataIndex: 'table_name',
      ellipsis: true,
      render: (val: string, record: TableConfig) => (
        <a onClick={() => navigate(`/data-maintenance/browse/${record.id}`)}
           style={{ cursor: 'pointer' }}>
          {val}
        </a>
      ),
    },
    {
      title: t('maintenance.tableAlias'),
      dataIndex: 'table_alias',
      ellipsis: true,
    },
    {
      title: t('dbMaintenance.fieldCount'),
      dataIndex: 'field_count',
      width: 80,
    },
    {
      title: t('maintenance.configVersion'),
      dataIndex: 'config_version',
      width: 80,
    },
    {
      title: t('maintenance.updatedAt'),
      dataIndex: 'updated_at',
      width: 160,
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '—',
    },
    {
      title: t('common.actions'),
      width: 180,
      render: (_: any, record: TableConfig) => (
        <Space size="small">
          <Tooltip title={t('maintenance.browse')}>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/data-maintenance/browse/${record.id}`)}
            />
          </Tooltip>
          <Tooltip title={t('maintenance.import')}>
            <Button
              type="link"
              size="small"
              icon={<ImportOutlined />}
              onClick={() => navigate(`/data-maintenance/import/${record.id}`)}
            />
          </Tooltip>
          <Tooltip title={t('tableConfig.fieldConfig')}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/table-config/fields/${record.id}`)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('dbMaintenance.title')}
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          value={selectedDsId}
          onChange={val => { setSelectedDsId(val); setActiveTab('batch'); handleReset(); }}
          placeholder={t('maintenance.selectDatasource')}
          style={{ width: 280 }}
          allowClear
          options={datasources.map(ds => ({
            value: ds.id,
            label: `${ds.datasource_name} (${ds.db_type})`,
          }))}
        />
        {selectedDsId && (
          <>
            <Button
              type={activeTab === 'batch' ? 'primary' : 'default'}
              onClick={() => setActiveTab('batch')}
              icon={<RocketOutlined />}
            >
              {t('dbMaintenance.batchManage')}
            </Button>
            <Button
              type={activeTab === 'managed' ? 'primary' : 'default'}
              onClick={() => setActiveTab('managed')}
              icon={<DatabaseOutlined />}
            >
              {t('dbMaintenance.managedTables')} ({managedTables.length})
            </Button>
          </>
        )}
      </Space>

      {selectedDsId && (
        <>
          {activeTab === 'batch' && (
            <>
              {/* Steps indicator */}
              <Steps
                current={currentStep}
                size="small"
                style={{ marginBottom: 24 }}
                items={[
                  { title: t('dbMaintenance.step1Title') },
                  { title: t('dbMaintenance.step2Title') },
                  { title: t('dbMaintenance.step3Title') },
                  { title: t('dbMaintenance.step4Title') },
                ]}
              />

              {/* Step 1: Table Selection */}
              {currentStep === 0 && (
                <>
                  {tableLoadError && (
                    <Alert
                      type="error"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={tableLoadError}
                      description={t('tableConfig.checkDatasourceConnection')}
                      action={
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => selectedDsId && loadTables(selectedDsId)}
                          loading={loadingTables}
                        >
                          {t('common.retry')}
                        </Button>
                      }
                    />
                  )}
                  <Space style={{ marginBottom: 12 }}>
                    <Input
                      placeholder={t('tableConfig.searchTable')}
                      prefix={<SearchOutlined />}
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      style={{ width: 280 }}
                      allowClear
                    />
                    <Button onClick={handleSelectAll}>{t('dbMaintenance.selectAll')}</Button>
                    <Button onClick={handleInvertSelection}>{t('dbMaintenance.invertSelection')}</Button>
                    <Button onClick={handleDeselectAll}>{t('dbMaintenance.deselectAll')}</Button>
                    <Text type="secondary">
                      {t('dbMaintenance.selectedCount', {
                        selected: selectedTableNames.length,
                        total: remoteTables.length,
                      })}
                    </Text>
                  </Space>

                  <Table
                    dataSource={filteredTables}
                    columns={tableSelectColumns}
                    rowKey="table_name"
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: total => `共 ${total} 张表` }}
                    loading={loadingTables}
                    scroll={{ y: 400 }}
                  />

                  <div style={{ marginTop: 16, textAlign: 'right' }}>
                    <Button
                      type="primary"
                      size="large"
                      icon={<RocketOutlined />}
                      disabled={selectedTableNames.length === 0}
                      onClick={handleStartBatch}
                    >
                      {t('dbMaintenance.startBatch', { count: selectedTableNames.length })}
                    </Button>
                  </div>
                </>
              )}

              {/* Step 2: Processing */}
              {currentStep === 1 && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <Spin size="large" />
                  <div style={{ marginTop: 24 }}>
                    <Title level={4}>{t('dbMaintenance.processing')}</Title>
                    <Progress
                      percent={totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0}
                      status="active"
                      style={{ maxWidth: 400, margin: '0 auto' }}
                    />
                    <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                      {t('dbMaintenance.processingProgress', {
                        current: processedCount,
                        total: totalToProcess,
                      })}
                    </Text>
                  </div>
                </div>
              )}

              {/* Step 3: Config Confirmation */}
              {currentStep === 2 && currentTable && (
                <>
                  {/* Progress bar */}
                  <div style={{ marginBottom: 16 }}>
                    <Space>
                      <Text strong>
                        {t('dbMaintenance.confirmProgress', {
                          confirmed: confirmedCount,
                          total: editableTables.length,
                        })}
                      </Text>
                      <Progress
                        percent={Math.round((confirmedCount / editableTables.length) * 100)}
                        style={{ width: 200 }}
                        size="small"
                      />
                    </Space>
                  </div>

                  {/* Current table header */}
                  <Card
                    size="small"
                    style={{ marginBottom: 16, background: '#fafafa' }}
                    title={
                      <Space>
                        <Text strong>
                          {t('dbMaintenance.currentTable')} {currentTable.table_name}
                          ({currentTableIdx + 1}/{editableTables.length})
                        </Text>
                        {currentTable.confirmed && (
                          <Tag color="success"><CheckOutlined /> {t('dbMaintenance.confirmed')}</Tag>
                        )}
                      </Space>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Space>
                        <Text>{t('dbMaintenance.tableAlias')}:</Text>
                        <Input
                          value={currentTable.display_name}
                          onChange={e => updateTableDisplayName(e.target.value)}
                          style={{ width: 280 }}
                          suffix={
                            currentTable.display_name !== currentTable.table_name ? (
                              <Tag color="blue" style={{ fontSize: 10 }}>🤖AI</Tag>
                            ) : null
                          }
                        />
                      </Space>
                      <Space>
                        <Text>{t('dbMaintenance.primaryKey')}:</Text>
                        <Input
                          value={currentTable.primary_key}
                          onChange={e => updateTablePrimaryKey(e.target.value)}
                          style={{ width: 280 }}
                        />
                      </Space>
                    </Space>
                  </Card>

                  {/* Field config table */}
                  <Table
                    dataSource={currentTable.fields}
                    columns={fieldColumns}
                    rowKey="field_name"
                    size="small"
                    pagination={false}
                    scroll={{ y: 350, x: 900 }}
                  />

                  {/* Navigation buttons */}
                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
                    <Space>
                      <Button
                        icon={<LeftOutlined />}
                        disabled={currentTableIdx === 0}
                        onClick={() => setCurrentTableIdx(prev => prev - 1)}
                      >
                        {t('dbMaintenance.prevTable')}
                      </Button>
                      <Button
                        icon={<RightOutlined />}
                        disabled={currentTableIdx >= editableTables.length - 1}
                        onClick={() => setCurrentTableIdx(prev => prev + 1)}
                      >
                        {t('dbMaintenance.nextTable')}
                      </Button>
                    </Space>
                    <Space>
                      <Button onClick={() => { setCurrentStep(0); }}>
                        {t('common.back')}
                      </Button>
                      <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={handleConfirmCurrent}
                        disabled={currentTable.confirmed}
                      >
                        {t('dbMaintenance.confirmCurrent')}
                      </Button>
                      <Button
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        onClick={handleConfirmAll}
                      >
                        {t('dbMaintenance.confirmAll')}
                      </Button>
                      {allConfirmed && (
                        <Button
                          type="primary"
                          danger
                          size="large"
                          onClick={handleBatchSave}
                        >
                          {t('dbMaintenance.batchSave', { count: editableTables.length })}
                        </Button>
                      )}
                    </Space>
                  </div>
                </>
              )}

              {/* Step 4: Save result */}
              {currentStep === 3 && (
                <div style={{ padding: '20px 0' }}>
                  {saving ? (
                    <div style={{ textAlign: 'center' }}>
                      <Spin size="large" />
                      <Title level={4} style={{ marginTop: 16 }}>
                        {t('dbMaintenance.saving')}
                      </Title>
                    </div>
                  ) : saveResult?.error ? (
                    <Result
                      status="error"
                      title={t('common.failed')}
                      extra={<Button type="primary" onClick={handleReset}>{t('dbMaintenance.backToStart')}</Button>}
                    />
                  ) : saveResult ? (
                    <Result
                      status="success"
                      title={t('dbMaintenance.saveSuccess', { count: saveResult.created })}
                      subTitle={saveResult.failed > 0
                        ? t('dbMaintenance.saveFailed', { count: saveResult.failed })
                        : undefined}
                      extra={
                        <Space>
                          <Button type="primary" onClick={handleReset}>
                            {t('dbMaintenance.continueManage')}
                          </Button>
                          <Button onClick={() => setActiveTab('managed')}>
                            {t('dbMaintenance.viewManaged')}
                          </Button>
                        </Space>
                      }
                    >
                      {saveResult.errors?.length > 0 && (
                        <Alert
                          type="warning"
                          message={t('dbMaintenance.errorDetails')}
                          description={
                            <ul>
                              {saveResult.errors.map((e: any, i: number) => (
                                <li key={i}>{e.table_name}: {e.error}</li>
                              ))}
                            </ul>
                          }
                        />
                      )}
                    </Result>
                  ) : null}
                </div>
              )}
            </>
          )}

          {/* Managed Tables Tab */}
          {activeTab === 'managed' && (
            <>
              <Space style={{ marginBottom: 16 }}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => selectedDsId && loadTables(selectedDsId)}
                >
                  {t('common.refresh')}
                </Button>
                <Divider type="vertical" />
                <Text>{t('dbMaintenance.exportFormat')}:</Text>
                <Radio.Group value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
                  <Radio.Button value="zip">ZIP</Radio.Button>
                  <Radio.Button value="multi_sheet">{t('dbMaintenance.multiSheet')}</Radio.Button>
                </Radio.Group>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  disabled={managedSelectedIds.length === 0}
                  loading={exporting}
                  onClick={handleBatchExport}
                >
                  {t('dbMaintenance.batchExport', { count: managedSelectedIds.length })}
                </Button>
              </Space>

              <Table
                dataSource={managedTables}
                columns={managedColumns}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 20, showSizeChanger: true }}
              />
            </>
          )}
        </>
      )}
    </Card>
  );
}
