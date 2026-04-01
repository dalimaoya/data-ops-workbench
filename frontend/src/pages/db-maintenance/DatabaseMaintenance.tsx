import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Select, Table, Input, Button, Checkbox, Space, Progress, Tag, message,
  Typography, Tooltip, Steps, Divider, Radio, Result, Spin, Modal, Descriptions,
  Alert, Upload,
} from 'antd';
import {
  SearchOutlined, RocketOutlined, CheckCircleOutlined,
  LeftOutlined, RightOutlined, DownloadOutlined, DatabaseOutlined,
  ReloadOutlined, CheckOutlined, EyeOutlined, EditOutlined,
  ImportOutlined, UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { listDatasources, getDatasourceDatabases, type Datasource } from '../../api/datasource';
import { buildDatasourceOptions } from '../../utils/datasourceOptions';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';
import { getRemoteTables, listTableConfigs, type RemoteTableInfo, type TableConfig } from '../../api/tableConfig';
import { findFirstHealthyDs } from '../../utils/datasourceHelper';
import {
  batchManageTables, batchConfirm, batchExport, batchImportValidate, batchImportConfirm,
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
  const { onlineStatus } = useDatasourceOnline();
  const [searchParams] = useSearchParams();

  // Step management
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: datasource + database + table selection
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedDsId, setSelectedDsId] = useState<number | undefined>();
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string | undefined>();
  const [loadingDbs, setLoadingDbs] = useState(false);
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
  const [exportLocked, setExportLocked] = useState(true);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [managedSearch, setManagedSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  // Batch import state
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [batchImportStep, setBatchImportStep] = useState(0); // 0=upload, 1=validation result, 2=execution result
  const [batchImportFile, setBatchImportFile] = useState<File | null>(null);
  const [batchImportValidating, setBatchImportValidating] = useState(false);
  const [batchImportResult, setBatchImportResult] = useState<any>(null);
  const [batchImportSelectedIds, setBatchImportSelectedIds] = useState<number[]>([]);
  const [batchImportConfirming, setBatchImportConfirming] = useState(false);
  const [batchImportFinalResult, setBatchImportFinalResult] = useState<any>(null);

  // Load datasources and restore from URL params
  useEffect(() => {
    listDatasources({ status: 'enabled' }).then(res => {
      const list = res.data || [];
      setDatasources(list);
      const dsParam = searchParams.get('ds');
      if (dsParam && !selectedDsId) {
        setSelectedDsId(Number(dsParam));
      } else if (list.length > 0 && !selectedDsId) {
        // 默认选中第1个连接正常的数据源
        const healthy = findFirstHealthyDs(list, onlineStatus);
        if (healthy) setSelectedDsId(healthy.id);
      }
    }).catch(() => {});
  }, []);

  // Load remote tables + managed info when datasource changes
  const loadTables = useCallback(async (dsId: number, dbName?: string) => {
    setLoadingTables(true);
    setRemoteTables([]);
    setSelectedTableNames([]);
    setTableLoadError(null);
    try {
      const [remoteRes, managedRes] = await Promise.all([
        getRemoteTables(dsId, dbName ? { db_name: dbName } : undefined),
        listTableConfigs({ datasource_id: dsId, page_size: 500 }),
      ]);

      const managedMap = new Map<string, TableConfig>();
      (managedRes.data as TableConfig[]).forEach(tc => {
        managedMap.set(tc.table_name, tc);
      });
      const allManaged = managedRes.data as TableConfig[];
      setManagedTables(allManaged);

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
      // Fetch available databases for this datasource
      setDatabases([]);
      setSelectedDb(undefined);
      setLoadingDbs(true);
      getDatasourceDatabases(selectedDsId)
        .then(res => setDatabases(res.data.databases || []))
        .catch(() => {})
        .finally(() => setLoadingDbs(false));
      // Load tables using datasource default
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

  // Convert a BatchTableResult to EditableTableConfig
  const toEditable = (r: BatchTableResult): EditableTableConfig => {
    const fields: EditableFieldConfig[] = r.fields.map(f => {
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
  };

  // Step 2: Start batch processing — process tables one by one for real-time progress
  const handleStartBatch = async () => {
    if (!selectedDsId || selectedTableNames.length === 0) return;

    setCurrentStep(1);
    setProcessing(true);
    const total = selectedTableNames.length;
    setTotalToProcess(total);
    setProcessedCount(0);
    setBatchResults([]);

    const allResults: BatchTableResult[] = [];

    try {
      for (let i = 0; i < total; i++) {
        const res = await batchManageTables({
          datasource_id: selectedDsId,
          db_name: selectedDb,
          table_names: [selectedTableNames[i]],
          auto_ai_suggest: true,
          sample_count: 50,
        });

        const data = (res.data as any).data || res.data;
        const results: BatchTableResult[] = data.results || [];
        allResults.push(...results);
        setBatchResults([...allResults]);
        setProcessedCount(i + 1);
      }

      const editables = allResults
        .filter((r: BatchTableResult) => r.status === 'success')
        .map(toEditable);

      setEditableTables(editables);
      setCurrentTableIdx(0);
      setConfirmedCount(0);

      // Move to step 3
      setTimeout(() => {
        setProcessing(false);
        if (editables.length > 0) {
          setCurrentStep(2);
        } else {
          message.warning(t('dbMaintenance.noSuccessTable'));
          setCurrentStep(0);
        }
      }, 500);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('dbMaintenance.batchManageFailed'));
      setProcessing(false);
      // If we have partial results, still show them
      if (allResults.length > 0) {
        const editables = allResults
          .filter((r: BatchTableResult) => r.status === 'success')
          .map(toEditable);
        if (editables.length > 0) {
          setEditableTables(editables);
          setCurrentTableIdx(0);
          setConfirmedCount(0);
          setCurrentStep(2);
          return;
        }
      }
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
        db_name: selectedDb,
        tables,
      });
      const data = (res.data as any).data || res.data;
      setSaveResult(data);
      message.success(t('dbMaintenance.batchSaveSuccess', { count: data.created }));
      // Refresh managed tables
      if (selectedDsId) loadTables(selectedDsId);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('dbMaintenance.batchSaveFailed'));
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
        format: exportLocked ? exportFormat : exportFormat + '_unlocked',
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
      width: 180,
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
      title: t('common.remark'),
      dataIndex: 'table_comment',
      ellipsis: true,
      width: 200,
      render: (val: string | undefined) => val || '—',
    },
    {
      title: t('dbMaintenance.fieldCount'),
      dataIndex: 'field_count',
      width: 70,
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
              onClick={() => navigate(`/data-maintenance/import/${record.table_config_id}?from=db-maintenance&ds=${selectedDsId}`)}
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
              onClick={() => navigate(`/data-maintenance/import/${record.id}?from=db-maintenance&ds=${selectedDsId}`)}
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
          onChange={val => {
            setSelectedDsId(val);
            setSelectedDb(undefined);
            setDatabases([]);
            setManagedSearch('');
            setManagedSelectedIds([]);
            setActiveTab('batch');
            handleReset();
          }}
          placeholder={t('maintenance.selectDatasource')}
          style={{ width: 280 }}
          allowClear
          options={buildDatasourceOptions(datasources, onlineStatus)}
        />
        {selectedDsId && databases.length > 0 && (
          <Select
            placeholder={t('tableConfig.selectDatabase')}
            style={{ width: 200 }}
            allowClear
            loading={loadingDbs}
            value={selectedDb}
            showSearch
            onChange={(val) => {
              setSelectedDb(val);
              if (selectedDsId) loadTables(selectedDsId, val);
            }}
            options={databases.map(d => ({ label: d, value: d }))}
          />
        )}
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
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Input
                      placeholder={t('tableConfig.searchTable')}
                      prefix={<SearchOutlined />}
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      style={{ width: 280 }}
                      allowClear
                    />
                    <Button size="small" onClick={handleSelectAll}>{t('dbMaintenance.selectAll')}</Button>
                    <Button size="small" onClick={handleInvertSelection}>{t('dbMaintenance.invertSelection')}</Button>
                    <Button size="small" onClick={handleDeselectAll}>{t('dbMaintenance.deselectAll')}</Button>
                    <Text type="secondary">
                      {t('dbMaintenance.selectedCount', {
                        selected: selectedTableNames.length,
                        total: remoteTables.length,
                      })}
                    </Text>
                    <Button
                      icon={<ReloadOutlined />}
                      size="small"
                      loading={loadingTables}
                      onClick={() => selectedDsId && loadTables(selectedDsId, selectedDb)}
                    >
                      {t('common.refresh')}
                    </Button>
                  </Space>

                  <Table
                    dataSource={filteredTables}
                    columns={tableSelectColumns}
                    rowKey="table_name"
                    size="small"
                    pagination={{
                      defaultPageSize: 20,
                      showSizeChanger: true,
                      pageSizeOptions: ['10', '20', '50', '100'],
                      showTotal: total => t('dbMaintenance.tableTotal', { total }),
                    }}
                    loading={loadingTables}
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
          {activeTab === 'managed' && (() => {
            const dbFiltered = selectedDb
              ? managedTables.filter(t => t.db_name === selectedDb)
              : managedTables;
            const filteredManaged = managedSearch
              ? dbFiltered.filter(t =>
                  t.table_name.toLowerCase().includes(managedSearch.toLowerCase())
                  || (t.table_alias && t.table_alias.toLowerCase().includes(managedSearch.toLowerCase()))
                )
              : dbFiltered;
            return (
            <>
              <Space style={{ marginBottom: 12 }} wrap>
                <Input
                  placeholder={t('tableConfig.searchTable')}
                  prefix={<SearchOutlined />}
                  value={managedSearch}
                  onChange={e => setManagedSearch(e.target.value)}
                  style={{ width: 280 }}
                  allowClear
                />
                <Button size="small" onClick={() => setManagedSelectedIds(filteredManaged.map(t => t.id))}>
                  {t('dbMaintenance.selectAll')}
                </Button>
                <Button size="small" onClick={() => {
                  const currentSet = new Set(managedSelectedIds);
                  const filteredIds = filteredManaged.map(t => t.id);
                  const inverted = filteredIds.filter(id => !currentSet.has(id));
                  setManagedSelectedIds(inverted);
                }}>
                  {t('dbMaintenance.invertSelection')}
                </Button>
                <Button size="small" onClick={() => setManagedSelectedIds([])}>
                  {t('dbMaintenance.deselectAll')}
                </Button>
                <Text type="secondary">
                  {t('dbMaintenance.selectedCount', { selected: managedSelectedIds.length, total: filteredManaged.length })}
                </Text>
                <Divider type="vertical" />
                <Button
                  icon={<ReloadOutlined />}
                  size="small"
                  onClick={() => selectedDsId && loadTables(selectedDsId, selectedDb)}
                >
                  {t('common.refresh')}
                </Button>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  disabled={managedSelectedIds.length === 0}
                  onClick={() => setExportModalOpen(true)}
                >
                  {t('dbMaintenance.batchExport', { count: managedSelectedIds.length })}
                </Button>
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => { setBatchImportOpen(true); setBatchImportStep(0); setBatchImportFile(null); setBatchImportResult(null); setBatchImportFinalResult(null); }}
                >
                  {t('dbMaintenance.batchImport')}
                </Button>
              </Space>

              {/* Batch Export Modal */}
              <Modal
                title={t('dbMaintenance.batchExport', { count: managedSelectedIds.length })}
                open={exportModalOpen}
                onCancel={() => setExportModalOpen(false)}
                onOk={() => { setExportModalOpen(false); handleBatchExport(); }}
                confirmLoading={exporting}
                okText={t('dataBrowse.confirmExport')}
              >
                <div style={{ marginBottom: 16 }}>
                  <p><strong>{t('dbMaintenance.exportFormat')}</strong></p>
                  <Radio.Group value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
                    <Radio value="zip">ZIP（{t('dbMaintenance.eachTableOneFile')}）</Radio>
                    <Radio value="multi_sheet">{t('dbMaintenance.multiSheet')}（{t('dbMaintenance.allTablesOneFile')}）</Radio>
                  </Radio.Group>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <Checkbox checked={exportLocked} onChange={e => setExportLocked(e.target.checked)}>
                    {t('dbMaintenance.exportLocked')}
                  </Checkbox>
                  <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                    {t('dbMaintenance.exportLockedHint')}
                  </div>
                </div>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label={t('dbMaintenance.exportTableCount')}>{managedSelectedIds.length}</Descriptions.Item>
                  <Descriptions.Item label={t('dbMaintenance.exportFormat')}>{exportFormat === 'zip' ? 'ZIP' : t('dbMaintenance.multiSheet')}</Descriptions.Item>
                </Descriptions>
              </Modal>

              {/* Batch Import Modal */}
              <Modal
                title={t('dbMaintenance.batchImport')}
                open={batchImportOpen}
                onCancel={() => setBatchImportOpen(false)}
                footer={null}
                width={700}
                destroyOnClose
              >
                {batchImportStep === 0 && (
                  <div>
                    <Upload.Dragger
                      accept=".zip,.xlsx"
                      beforeUpload={(file) => { setBatchImportFile(file); return false; }}
                      maxCount={1}
                      fileList={batchImportFile ? [batchImportFile as any] : []}
                    >
                      <p>{t('dbMaintenance.batchImportDragHint')}</p>
                    </Upload.Dragger>
                    <div style={{ marginTop: 16, textAlign: 'right' }}>
                      <Button type="primary" disabled={!batchImportFile} loading={batchImportValidating}
                        onClick={async () => {
                          if (!batchImportFile || !selectedDsId) return;
                          setBatchImportValidating(true);
                          try {
                            const res = await batchImportValidate(batchImportFile, selectedDsId);
                            setBatchImportResult(res.data.data || res.data);
                            const matched = (res.data.data?.tables || res.data.tables || []).filter((tbl: any) => tbl.status === 'matched');
                            setBatchImportSelectedIds(matched.map((tbl: any) => tbl.table_config_id));
                            setBatchImportStep(1);
                          } catch (e: any) {
                            message.error(e?.response?.data?.detail || t('dbMaintenance.validateFailed'));
                          } finally {
                            setBatchImportValidating(false);
                          }
                        }}>
                        {t('dbMaintenance.startValidate')}
                      </Button>
                    </div>
                  </div>
                )}

                {batchImportStep === 1 && batchImportResult && (
                  <div>
                    <div style={{ marginBottom: 12 }}>
                      <Text>{t('dbMaintenance.batchImportMatched', { total: batchImportResult.tables?.length || 0, matched: batchImportResult.tables?.filter((tbl: any) => tbl.status === 'matched').length || 0 })}</Text>
                    </div>
                    {(batchImportResult.tables || []).map((tbl: any, idx: number) => (
                      <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Checkbox
                          checked={batchImportSelectedIds.includes(tbl.table_config_id)}
                          disabled={tbl.status !== 'matched'}
                          onChange={e => {
                            if (e.target.checked) setBatchImportSelectedIds(prev => [...prev, tbl.table_config_id]);
                            else setBatchImportSelectedIds(prev => prev.filter(id => id !== tbl.table_config_id));
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <Text strong>{tbl.table_alias || tbl.table_name || tbl.source_name}</Text>
                          {tbl.table_name && <Text type="secondary"> ({tbl.table_name})</Text>}
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>{tbl.source_name} · {t('dbMaintenance.rows', { count: tbl.row_count || 0 })}</Text>
                        </div>
                        <Tag color={tbl.status === 'matched' ? 'success' : tbl.status === 'error' ? 'error' : 'warning'}>
                          {tbl.status === 'matched' ? t('dbMaintenance.statusMatched') : tbl.status === 'error' ? t('dbMaintenance.statusError') : t('dbMaintenance.statusUnmatched')}
                        </Tag>
                        {tbl.message && <Text type="danger" style={{ fontSize: 12 }}>{tbl.message}</Text>}
                      </div>
                    ))}
                    <div style={{ marginTop: 16, textAlign: 'right' }}>
                      <Space>
                        <Button onClick={() => setBatchImportStep(0)}>{t('smartImport.prev')}</Button>
                        <Button type="primary" disabled={batchImportSelectedIds.length === 0} loading={batchImportConfirming}
                          onClick={async () => {
                            setBatchImportConfirming(true);
                            try {
                              const res = await batchImportConfirm(batchImportResult.batch_import_id, batchImportSelectedIds);
                              setBatchImportFinalResult(res.data.data || res.data);
                              setBatchImportStep(2);
                            } catch (e: any) {
                              message.error(e?.response?.data?.detail || t('dbMaintenance.importFailed'));
                            } finally {
                              setBatchImportConfirming(false);
                            }
                          }}>
                          {t('dbMaintenance.batchImportConfirm', { count: batchImportSelectedIds.length })}
                        </Button>
                      </Space>
                    </div>
                  </div>
                )}

                {batchImportStep === 2 && batchImportFinalResult && (
                  <Result
                    status={batchImportFinalResult.failed === 0 ? 'success' : 'warning'}
                    title={t('dbMaintenance.batchImportDone', { success: batchImportFinalResult.succeeded || 0, failed: batchImportFinalResult.failed || 0 })}
                    extra={<Button type="primary" onClick={() => { setBatchImportOpen(false); if (selectedDsId) loadTables(selectedDsId, selectedDb); }}>{t('common.close')}</Button>}
                  >
                    {(batchImportFinalResult.results || []).map((r: any, i: number) => (
                      <div key={i} style={{ padding: '4px 0' }}>
                        <Tag color={r.status === 'success' ? 'success' : 'error'}>{r.status === 'success' ? '✅' : '❌'}</Tag>
                        <Text>{r.table_name}</Text>
                        {r.status === 'success' && <Text type="secondary"> — {r.message || t('dbMaintenance.importSuccess')}</Text>}
                        {r.status !== 'success' && <Text type="danger"> — {r.error || t('dbMaintenance.failed')}</Text>}
                      </div>
                    ))}
                  </Result>
                )}
              </Modal>

              <Table
                dataSource={filteredManaged}
                columns={managedColumns}
                rowKey="id"
                size="small"
                pagination={{
                  defaultPageSize: 20,
                  showSizeChanger: true,
                  pageSizeOptions: ['10', '20', '50', '100'],
                }}
              />
            </>
            );
          })()}
        </>
      )}
    </Card>
  );
}
