import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Table, Card, Input, Button, Space, message, Select, Row, Col, Descriptions, Tag, Modal, Radio, Checkbox, Alert,
} from 'antd';
import {
  SearchOutlined, DownloadOutlined, UploadOutlined, ReloadOutlined, ArrowLeftOutlined,
  DeleteOutlined, ExclamationCircleOutlined, EditOutlined, PlusOutlined, SaveOutlined, CloseOutlined,
  RobotOutlined, BulbOutlined,
} from '@ant-design/icons';
import { browseTableData, getExportInfo, exportTemplate, deleteRows, clearTable, inlineUpdate, batchInsert, asyncExport } from '../../api/dataMaintenance';
import AIQueryPanel from './AIQueryPanel';
import AIBatchFillPanel from './AIBatchFillPanel';
import AISmartFillModal from './AISmartFillModal';
import type { NLQueryFilter } from '../../api/aiNlQuery';
import { isAIAvailable } from '../../utils/aiGuard';
import type { ColumnMeta, InlineChange } from '../../api/dataMaintenance';
import { getTableConfig, checkStructure } from '../../api/tableConfig';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from 'react-i18next';

export default function DataBrowse() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const canOperate = user?.role === 'superadmin' || user?.role === 'admin' || user?.role === 'operator';
  const tableConfigId = Number(id);

  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [rows, setRows] = useState<Record<string, string | null>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [filterField, setFilterField] = useState<string>();
  const [filterValue, setFilterValue] = useState('');
  const [tableInfo, setTableInfo] = useState<Record<string, unknown>>({});
  const [allowDelete, setAllowDelete] = useState(false);
  const [allowInsert, setAllowInsert] = useState(false);

  // Row selection for delete
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  // Export modal
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<'all' | 'current'>('all');
  const [exportLocked, setExportLocked] = useState(true);
  const [exportInfo, setExportInfo] = useState<Record<string, unknown>>({});
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearConfirmInput, setClearConfirmInput] = useState('');

  // PK fields for building pk_key
  const [pkFieldNames, setPkFieldNames] = useState<string[]>([]);

  // v2.1: Inline editing
  const [editMode, setEditMode] = useState(false);
  const [editedCells, setEditedCells] = useState<Record<string, Record<string, string | null>>>({});
  const [saving, setSaving] = useState(false);

  // v2.1.2: Batch insert modal
  const [batchInsertOpen, setBatchInsertOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<Record<string, string | null>[]>([]);
  const [insertSaving, setInsertSaving] = useState(false);

  // Diff preview modal
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffData, setDiffData] = useState<Array<{ pk_key: string; field_name: string; field_alias: string; old_value: string | null; new_value: string | null }>>([]);

  // Structure change detection
  const [structureChanged, setStructureChanged] = useState(false);

  // AI availability (pre-check once on mount)
  const [aiEnabled, setAiEnabled] = useState(false);

  // v3.0: AI NL Query
  const [aiQueryOpen, setAiQueryOpen] = useState(false);
  const [aiFilters, setAiFilters] = useState<NLQueryFilter[]>([]);

  // v3.0: AI Batch Fill
  const [batchFillOpen, setBatchFillOpen] = useState(false);

  // v4.4: AI Smart Fill
  const [smartFillOpen, setSmartFillOpen] = useState(false);

  const originalRowsRef = useRef<Record<string, Record<string, string | null>>>({});

  // v3.0: Apply AI filters to browse
  const handleApplyAIFilters = useCallback((filters: NLQueryFilter[]) => {
    setAiFilters(filters);
    setPage(1);
    // Clear manual filters when AI filters are applied
    setKeyword('');
    setFilterField(undefined);
    setFilterValue('');
  }, []);

  const handleClearAIFilters = useCallback(() => {
    setAiFilters([]);
    setPage(1);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const fieldFilters: Record<string, string> = {};
      if (filterField && filterValue) {
        fieldFilters[filterField] = filterValue;
      }
      const res = await browseTableData(tableConfigId, {
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
        field_filters: Object.keys(fieldFilters).length ? JSON.stringify(fieldFilters) : undefined,
        structured_filters: aiFilters.length > 0 ? JSON.stringify(aiFilters) : undefined,
      });
      setColumns(res.data.columns);
      setRows(res.data.rows);
      setTotal(res.data.total);
      setAllowDelete(!!res.data.allow_delete_rows);
      const pks = res.data.columns.filter(c => c.is_primary_key).map(c => c.field_name);
      setPkFieldNames(pks);
      const origMap: Record<string, Record<string, string | null>> = {};
      for (const row of res.data.rows) {
        const pkKey = pks.map(pk => row[pk] ?? '').join('|');
        origMap[pkKey] = { ...row };
      }
      originalRowsRef.current = origMap;
    } catch {
      message.error(t('dataBrowse.dataFetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [tableConfigId, page, pageSize, keyword, filterField, filterValue, aiFilters]);

  useEffect(() => {
    getTableConfig(tableConfigId).then(res => {
      const d = res.data as unknown as Record<string, unknown>;
      setTableInfo(d);
      setAllowInsert(!!(d as { allow_insert_rows?: number }).allow_insert_rows);
    }).catch(() => {});
    // Silent structure check
    checkStructure(tableConfigId).then(res => {
      if (res.data.status === 'changed') setStructureChanged(true);
    }).catch(() => {});
    // Pre-check AI availability (silent, no modal)
    isAIAvailable().then(ok => setAiEnabled(ok)).catch(() => {});
    fetchData();
  }, [tableConfigId]);

  useEffect(() => { fetchData(); }, [page, pageSize]);

  const handleSearch = () => { setPage(1); fetchData(); };

  const buildPkKey = (row: Record<string, string | null>) =>
    pkFieldNames.map(pk => row[pk] ?? '').join('|');

  const buildPkValues = (row: Record<string, string | null>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const pk of pkFieldNames) {
      result[pk] = row[pk] ?? '';
    }
    return result;
  };

  const handleCellChange = (pkKey: string, fieldName: string, value: string | null) => {
    setEditedCells(prev => ({
      ...prev,
      [pkKey]: {
        ...(prev[pkKey] || {}),
        [fieldName]: value,
      },
    }));
  };

  const isCellModified = (pkKey: string, fieldName: string): boolean => {
    const edited = editedCells[pkKey]?.[fieldName];
    if (edited === undefined) return false;
    const original = originalRowsRef.current[pkKey]?.[fieldName] ?? null;
    return edited !== original;
  };

  const getCellValue = (pkKey: string, fieldName: string, originalValue: string | null): string | null => {
    const edited = editedCells[pkKey]?.[fieldName];
    return edited !== undefined ? edited : originalValue;
  };

  const getChangeCount = (): number => {
    let count = 0;
    for (const pkKey of Object.keys(editedCells)) {
      for (const fn of Object.keys(editedCells[pkKey])) {
        if (isCellModified(pkKey, fn)) count++;
      }
    }
    return count;
  };

  const collectChanges = (): InlineChange[] => {
    const changes: InlineChange[] = [];
    for (const pkKey of Object.keys(editedCells)) {
      const updates: Record<string, string | null> = {};
      for (const fn of Object.keys(editedCells[pkKey])) {
        if (isCellModified(pkKey, fn)) {
          updates[fn] = editedCells[pkKey][fn];
        }
      }
      if (Object.keys(updates).length > 0) {
        const origRow = originalRowsRef.current[pkKey];
        if (origRow) {
          changes.push({
            pk_values: buildPkValues(origRow),
            updates,
          });
        }
      }
    }
    return changes;
  };

  const buildDiffData = () => {
    const diffs: typeof diffData = [];
    for (const pkKey of Object.keys(editedCells)) {
      for (const fn of Object.keys(editedCells[pkKey])) {
        if (isCellModified(pkKey, fn)) {
          const col = columns.find(c => c.field_name === fn);
          diffs.push({
            pk_key: pkKey,
            field_name: fn,
            field_alias: col?.field_alias || fn,
            old_value: originalRowsRef.current[pkKey]?.[fn] ?? null,
            new_value: editedCells[pkKey][fn],
          });
        }
      }
    }
    return diffs;
  };

  const handleEnterEditMode = () => {
    setEditMode(true);
    setEditedCells({});
    setSelectedRowKeys([]);
  };

  const handleCancelEdit = () => {
    if (getChangeCount() > 0) {
      Modal.confirm({
        title: t('dataBrowse.cancelEditTitle'),
        content: t('dataBrowse.cancelEditContent', { count: getChangeCount() }),
        okText: t('dataBrowse.cancelEditOk'),
        cancelText: t('dataBrowse.cancelEditCancel'),
        onOk: () => {
          setEditMode(false);
          setEditedCells({});
        },
      });
    } else {
      setEditMode(false);
      setEditedCells({});
    }
  };

  const handleSaveClick = () => {
    const changes = collectChanges();
    if (changes.length === 0) {
      message.info(t('dataBrowse.noChanges'));
      return;
    }
    setDiffData(buildDiffData());
    setDiffModalOpen(true);
  };

  const handleConfirmSave = async () => {
    const changes = collectChanges();
    setSaving(true);
    try {
      const res = await inlineUpdate(tableConfigId, changes);
      if (res.data.status === 'success') {
        message.success(t('dataBrowse.saveSuccess', { updated: res.data.updated, changes: res.data.change_count }));
      } else {
        message.warning(t('dataBrowse.savePartial', { success: res.data.success, failed: res.data.failed }));
      }
      setDiffModalOpen(false);
      setEditMode(false);
      setEditedCells({});
      fetchData();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || t('dataBrowse.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // v2.1.2: Batch insert modal
  const createEmptyRows = (count: number): Record<string, string | null>[] => {
    return Array.from({ length: count }, () => {
      const row: Record<string, string | null> = {};
      for (const col of columns) {
        row[col.field_name] = null;
      }
      return row;
    });
  };

  const handleAddRow = () => {
    setBatchRows(createEmptyRows(5));
    setBatchInsertOpen(true);
  };

  const handleAddMoreRows = () => {
    setBatchRows(prev => [...prev, ...createEmptyRows(5)]);
  };

  const handleBatchCellChange = (rowIndex: number, fieldName: string, value: string | null) => {
    setBatchRows(prev => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [fieldName]: value };
      return next;
    });
  };

  const handleBatchPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text || !text.includes('\t')) return;

    e.preventDefault();
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return;

    const editableFields = columns
      .filter(c => !c.is_system_field)
      .map(c => c.field_name);

    setBatchRows(prev => {
      const newRows = [...prev];
      while (newRows.length < lines.length) {
        const row: Record<string, string | null> = {};
        for (const col of columns) {
          row[col.field_name] = null;
        }
        newRows.push(row);
      }
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split('\t');
        for (let j = 0; j < cells.length && j < editableFields.length; j++) {
          const val = cells[j].trim();
          newRows[i] = { ...newRows[i], [editableFields[j]]: val || null };
        }
      }
      return newRows;
    });
    message.success(t('dataBrowse.pasteSuccess', { count: lines.length }));
  };

  const handleConfirmBatchInsert = async () => {
    const validRows = batchRows.filter(row =>
      Object.values(row).some(v => v !== null && String(v).trim() !== '')
    );
    if (validRows.length === 0) {
      message.warning(t('dataBrowse.batchInsertEmpty'));
      return;
    }
    for (let i = 0; i < validRows.length; i++) {
      for (const pk of pkFieldNames) {
        if (!validRows[i][pk] || String(validRows[i][pk]).trim() === '') {
          const col = columns.find(c => c.field_name === pk);
          message.warning(t('dataBrowse.batchInsertPkEmpty', { row: i + 1, field: col?.field_alias || pk }));
          return;
        }
      }
    }
    setInsertSaving(true);
    try {
      const res = await batchInsert(tableConfigId, validRows);
      if (res.data.status === 'success') {
        message.success(t('dataBrowse.batchInsertSuccess', { count: res.data.success }));
      } else {
        message.warning(t('dataBrowse.batchInsertPartial', { success: res.data.success, failed: res.data.failed }));
      }
      setBatchInsertOpen(false);
      setBatchRows([]);
      fetchData();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || t('dataBrowse.batchInsertFailed'));
    } finally {
      setInsertSaving(false);
    }
  };

  // Smart column width based on field type
  const getColWidth = (col: ColumnMeta): number => {
    if (col.is_primary_key) return 80;
    const dt = (col.db_data_type || '').toLowerCase();
    if (/^(int|bigint|smallint|tinyint|serial|float|double|decimal|numeric|number|real)/.test(dt)) return 90;
    if (/^(date|time|datetime|timestamp)/.test(dt)) return 160;
    if (/^(text|longtext|mediumtext|clob|json|ntext)/.test(dt)) return 220;
    const m = dt.match(/\((\d+)\)/);
    if (m && parseInt(m[1]) > 100) return 200;
    return 130;
  };

  const tableColumns = columns.map((col) => {
    const colWidth = getColWidth(col);
    const baseCol = {
      title: col.is_primary_key
        ? <span>{col.field_alias} <Tag color="blue" style={{ fontSize: 10 }}>PK</Tag></span>
        : col.field_alias,
      dataIndex: col.field_name,
      key: col.field_name,
      fixed: col.is_primary_key ? 'left' as const : undefined,
      width: colWidth,
      ellipsis: !editMode,
    };

    if (editMode) {
      return {
        ...baseCol,
        render: (v: string | null, record: Record<string, string | null>) => {
          const pkKey = buildPkKey(record);
          const isEditable = col.is_editable && !col.is_primary_key && !col.is_system_field;
          const currentValue = getCellValue(pkKey, col.field_name, v);
          const modified = isCellModified(pkKey, col.field_name);

          if (!isEditable) {
            return <span style={{ color: '#999', background: '#f5f5f5', padding: '1px 4px', borderRadius: 2, fontSize: 12 }}>{v ?? <span style={{ color: '#ccc' }}>NULL</span>}</span>;
          }

          return (
            <Input.TextArea
              size="small"
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={currentValue ?? ''}
              onChange={(e) => handleCellChange(pkKey, col.field_name, e.target.value || null)}
              style={{
                background: modified ? '#fffbe6' : undefined,
                borderColor: modified ? '#faad14' : undefined,
                fontSize: 12,
                padding: '2px 4px',
              }}
            />
          );
        },
      };
    }

    return {
      ...baseCol,
      render: (v: string | null) => v ?? <span style={{ color: '#ccc' }}>NULL</span>,
    };
  });

  const handleExportClick = async () => {
    try {
      const res = await getExportInfo(tableConfigId);
      setExportInfo(res.data as unknown as Record<string, unknown>);
      setExportModalOpen(true);
    } catch {
      message.error(t('dataBrowse.exportInfoFailed'));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const estimatedRows = (exportInfo as { estimated_rows?: number }).estimated_rows ?? 0;
      const fieldFilters: Record<string, string> = {};
      if (filterField && filterValue) fieldFilters[filterField] = filterValue;

      if (estimatedRows > 5000) {
        await asyncExport(tableConfigId, {
          export_type: exportType,
          keyword: exportType === 'current' ? keyword || undefined : undefined,
          field_filters: exportType === 'current' && Object.keys(fieldFilters).length ? JSON.stringify(fieldFilters) : undefined,
          unlocked: exportLocked ? undefined : '1',
        });
        message.success(t('dataBrowse.asyncExportCreated'));
        setExportModalOpen(false);
      } else {
        const res = await exportTemplate(tableConfigId, {
          export_type: exportType,
          keyword: exportType === 'current' ? keyword || undefined : undefined,
          field_filters: exportType === 'current' && Object.keys(fieldFilters).length ? JSON.stringify(fieldFilters) : undefined,
          unlocked: exportLocked ? undefined : '1',
        });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        const disposition = res.headers['content-disposition'];
        let filename = `export_${tableConfigId}.xlsx`;
        if (disposition) {
          const m = disposition.match(/filename\*?=(?:UTF-8'')?([^;\n]+)/i);
          if (m) filename = decodeURIComponent(m[1].replace(/"/g, ''));
        }
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
        message.success(t('dataBrowse.exportSuccess'));
        setExportModalOpen(false);
      }
    } catch {
      message.error(t('dataBrowse.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  // v2.0: Delete selected rows
  const handleDeleteRows = () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('dataBrowse.deleteSelectFirst'));
      return;
    }
    Modal.confirm({
      title: t('dataBrowse.confirmDelete'),
      icon: <ExclamationCircleOutlined />,
      content: t('dataBrowse.confirmDeleteContent', { count: selectedRowKeys.length }),
      okText: t('dataBrowse.confirmDeleteOk'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setDeleting(true);
        try {
          const res = await deleteRows(tableConfigId, selectedRowKeys);
          if (res.data.status === 'success') {
            message.success(t('dataBrowse.deleteSuccess', { count: res.data.deleted }));
          } else {
            message.warning(t('dataBrowse.deletePartial', { deleted: res.data.deleted, failed: res.data.failed }));
          }
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: unknown) {
          const err = e as { response?: { data?: { detail?: string } } };
          message.error(err?.response?.data?.detail || t('dataBrowse.deleteFailed'));
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const handleClearTable = async () => {
    setClearing(true);
    try {
      const res = await clearTable(tableConfigId);
      message.success(t('dataBrowse.clearTableSuccess', { count: res.data.deleted_count }));
      setClearModalOpen(false);
      setClearConfirmInput('');
      fetchData();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || t('dataBrowse.deleteFailed'));
    } finally {
      setClearing(false);
    }
  };

  const rowSelection = (canOperate && allowDelete) ? {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
  } : undefined;

  return (
    <div>
      {structureChanged && (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ marginBottom: 12 }}
          message={t('dataBrowse.structureChangedWarning')}
          action={
            <Button size="small" onClick={() => navigate(`/table-config/detail/${tableConfigId}`)}>
              {t('dataBrowse.goSyncFields')}
            </Button>
          }
        />
      )}
      <Card
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/data-maintenance')} />
            <span>{t('dataBrowse.title')} - {(tableInfo as { table_alias?: string }).table_alias || (tableInfo as { table_name?: string }).table_name || ''}</span>
            {editMode && <Tag color="orange">{t('dataBrowse.editMode')}</Tag>}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={5}>
          <Descriptions.Item label={t('common.datasource')}>{(tableInfo as { datasource_name?: string }).datasource_name || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('common.tableName')}>{(tableInfo as { table_name?: string }).table_name || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('maintenance.tableAlias')}>{(tableInfo as { table_alias?: string }).table_alias || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('dataBrowse.configVersionLabel')}>v{String((tableInfo as { config_version?: number }).config_version || 0)}</Descriptions.Item>
          <Descriptions.Item label={t('dataBrowse.structureStatusLabel')}>
            {(() => {
              const status = (tableInfo as { structure_check_status?: string }).structure_check_status;
              const map: Record<string, { color: string; label: string }> = {
                normal: { color: 'green', label: t('maintenance.structureNormal') },
                changed: { color: 'red', label: t('maintenance.structureChanged') },
                error: { color: 'orange', label: t('maintenance.structureError') },
              };
              const info = map[status || ''] || { color: 'default', label: status || '-' };
              return <Tag color={info.color}>{info.label}</Tag>;
            })()}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card>
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col flex="auto">
            {!editMode ? (
              <Space wrap>
                <Input
                  placeholder={t('dataBrowse.globalSearch')}
                  prefix={<SearchOutlined />}
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  onPressEnter={handleSearch}
                  style={{ width: 220 }}
                  allowClear
                />
                <Select
                  placeholder={t('dataBrowse.fieldFilter')}
                  allowClear
                  style={{ width: 160 }}
                  value={filterField}
                  onChange={v => setFilterField(v)}
                  options={columns.map(c => ({ value: c.field_name, label: c.field_alias }))}
                />
                {filterField && (
                  <Input
                    placeholder={t('dataBrowse.fieldFilterValue', { field: columns.find(c => c.field_name === filterField)?.field_alias || '' })}
                    value={filterValue}
                    onChange={e => setFilterValue(e.target.value)}
                    onPressEnter={handleSearch}
                    style={{ width: 180 }}
                    allowClear
                  />
                )}
                <Button icon={<SearchOutlined />} type="primary" onClick={handleSearch}>{t('common.search')}</Button>
                <Button icon={<ReloadOutlined />} onClick={() => { setKeyword(''); setFilterField(undefined); setFilterValue(''); setAiFilters([]); setPage(1); setTimeout(fetchData, 0); }}>{t('common.reset')}</Button>
                {aiEnabled && (
                  <Button
                    icon={<RobotOutlined />}
                    type={aiQueryOpen ? 'primary' : 'default'}
                    onClick={() => setAiQueryOpen(!aiQueryOpen)}
                    style={aiQueryOpen ? {} : { borderColor: '#1677ff', color: '#1677ff' }}
                  >
                    🤖 AI 查询
                  </Button>
                )}
              </Space>
            ) : (
              <Space>
                <Tag color="orange" style={{ fontSize: 14, padding: '4px 12px' }}>
                  {t('dataBrowse.editModeTag')}
                </Tag>
                {getChangeCount() > 0 && (
                  <Tag color="blue">{t('dataBrowse.editModeHint', { count: getChangeCount() })}</Tag>
                )}
              </Space>
            )}
          </Col>
          <Col>
            <Space>
              {editMode ? (
                <>
                  <Button
                    icon={<SaveOutlined />}
                    type="primary"
                    loading={saving}
                    onClick={handleSaveClick}
                    disabled={getChangeCount() === 0}
                  >
                    {t('dataBrowse.saveChanges', { count: getChangeCount() })}
                  </Button>
                  <Button icon={<CloseOutlined />} onClick={handleCancelEdit}>{t('dataBrowse.exitEditMode')}</Button>
                </>
              ) : (
                <>
                  {canOperate && (
                    <Button icon={<EditOutlined />} onClick={handleEnterEditMode}>{t('dataBrowse.enterEditMode')}</Button>
                  )}
                  {canOperate && allowInsert && !editMode && (
                    <Button icon={<PlusOutlined />} onClick={handleAddRow}>{t('dataBrowse.addRow')}</Button>
                  )}
                  {canOperate && allowDelete && selectedRowKeys.length > 0 && (
                    <Button
                      icon={<DeleteOutlined />}
                      danger
                      loading={deleting}
                      onClick={handleDeleteRows}
                    >
                      {t('dataBrowse.deleteSelectedRows', { count: selectedRowKeys.length })}
                    </Button>
                  )}
                  {canOperate && allowDelete && !editMode && (
                    <Button
                      icon={<DeleteOutlined />}
                      danger
                      loading={clearing}
                      onClick={() => { setClearConfirmInput(''); setClearModalOpen(true); }}
                    >
                      {t('dataBrowse.clearTable')}
                    </Button>
                  )}
                  {canOperate && <Button icon={<DownloadOutlined />} onClick={handleExportClick}>{t('dataBrowse.exportTemplate')}</Button>}
                  {canOperate && <Button icon={<UploadOutlined />} onClick={() => navigate(`/data-maintenance/import/${tableConfigId}`)}>{t('dataBrowse.uploadTemplate')}</Button>}
                  {canOperate && aiEnabled && (
                    <Button
                      icon={<RobotOutlined />}
                      onClick={() => setBatchFillOpen(true)}
                      style={{ borderColor: '#722ed1', color: '#722ed1' }}
                    >
                      🤖 AI 批量修改
                    </Button>
                  )}
                  {canOperate && aiEnabled && (
                    <Button
                      icon={<BulbOutlined />}
                      onClick={() => setSmartFillOpen(true)}
                      style={{ borderColor: '#13c2c2', color: '#13c2c2' }}
                    >
                      🧠 AI 智能填充
                    </Button>
                  )}
                </>
              )}
            </Space>
          </Col>
        </Row>

        {/* v3.0: AI Query Panel */}
        {aiQueryOpen && (
          <AIQueryPanel
            tableConfigId={tableConfigId}
            columns={columns}
            onApplyFilters={handleApplyAIFilters}
            onClose={() => setAiQueryOpen(false)}
          />
        )}

        {/* v3.0: Active AI filters indicator */}
        {aiFilters.length > 0 && !aiQueryOpen && (
          <div style={{
            background: '#f0f7ff',
            border: '1px solid #91caff',
            borderRadius: 6,
            padding: '6px 12px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span style={{ fontSize: 13, color: '#333' }}>{t('dataBrowse.aiFilterActive')}</span>
            {aiFilters.map((f, i) => (
              <Tag key={i} color="blue" style={{ fontSize: 12 }}>{f.display}</Tag>
            ))}
            <Button type="link" size="small" onClick={handleClearAIFilters} danger>{t('dataBrowse.clearAIFilter')}</Button>
          </div>
        )}

        <Table
          rowKey={(r) => r.__isNewRow ? '__new__' : buildPkKey(r)}
          columns={tableColumns}
          dataSource={rows}
          loading={loading}
          size="small"
          rowSelection={rowSelection}
          scroll={{ x: Math.max(columns.reduce((sum, c) => sum + getColWidth(c), 0), 800) }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showTotal: (total) => t('common.total', { count: total }),
          }}
        />
      </Card>

      {/* Export Modal */}
      <Modal
        title={t('dataBrowse.exportTitle')}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        confirmLoading={exporting}
        okText={t('dataBrowse.confirmExport')}
      >
        <div style={{ marginBottom: 16 }}>
          <p><strong>{t('dataBrowse.exportType')}</strong></p>
          <Radio.Group value={exportType} onChange={e => setExportType(e.target.value)}>
            <Radio value="all">{t('dataBrowse.exportTypeAll')}</Radio>
            <Radio value="current">{t('dataBrowse.exportTypeCurrent')}</Radio>
          </Radio.Group>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Checkbox checked={exportLocked} onChange={e => setExportLocked(e.target.checked)}>
            {t('dataBrowse.exportLockCells')}
          </Checkbox>
        </div>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('dataBrowse.exportEstimatedRows')}>{String((exportInfo as { estimated_rows?: number }).estimated_rows ?? '-')}</Descriptions.Item>
          <Descriptions.Item label={t('dataBrowse.exportFieldCount')}>{String((exportInfo as { field_count?: number }).field_count ?? '-')}</Descriptions.Item>
          <Descriptions.Item label={t('dataBrowse.exportConfigVersion')}>v{String((exportInfo as { config_version?: number }).config_version ?? 0)}</Descriptions.Item>
        </Descriptions>
        {((exportInfo as { estimated_rows?: number }).estimated_rows ?? 0) > 5000 && (
          <p style={{ marginTop: 12, color: '#fa8c16', fontSize: 13, fontWeight: 500 }}>
            {t('dataBrowse.exportLargeHint')}
          </p>
        )}
        <p style={{ marginTop: 12, color: '#999', fontSize: 12 }}>
          {t('dataBrowse.exportNote')}
        </p>
      </Modal>

      {/* Clear Table Modal */}
      <Modal
        title={t('dataBrowse.clearTable')}
        open={clearModalOpen}
        onCancel={() => setClearModalOpen(false)}
        onOk={handleClearTable}
        confirmLoading={clearing}
        okText={t('common.confirm')}
        okType="danger"
        okButtonProps={{ disabled: clearConfirmInput !== ((tableInfo as { table_name?: string }).table_name || '') }}
      >
        <p style={{ marginBottom: 12 }}>{t('dataBrowse.clearTableConfirm')}</p>
        <Input
          placeholder={t('dataBrowse.clearTableInputPlaceholder')}
          value={clearConfirmInput}
          onChange={e => setClearConfirmInput(e.target.value)}
        />
      </Modal>

      {/* Batch Insert Modal (v2.1.2) */}
      <Modal
        title={
          <Space>
            <PlusOutlined />
            <span>{t('dataBrowse.batchInsertTitle')}</span>
            <Tag color="green">{t('dataBrowse.batchInsertDataCount', { count: batchRows.filter(r => Object.values(r).some(v => v !== null && String(v).trim() !== '')).length })}</Tag>
          </Space>
        }
        open={batchInsertOpen}
        onCancel={() => { setBatchInsertOpen(false); setBatchRows([]); }}
        onOk={handleConfirmBatchInsert}
        confirmLoading={insertSaving}
        okText={t('dataBrowse.batchInsertConfirm')}
        cancelText={t('common.cancel')}
        width={Math.min(columns.filter(c => !c.is_system_field).length * 160 + 100, 1200)}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          {t('dataBrowse.batchInsertHintSimple')}
        </div>
        <div
          onPaste={handleBatchPaste}
          style={{ maxHeight: 480, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4 }}
          tabIndex={0}
        >
          <Table
            size="small"
            pagination={false}
            dataSource={batchRows.map((r, i) => ({ ...r, __idx: i }))}
            rowKey="__idx"
            scroll={{ x: Math.max(columns.filter(c => !c.is_system_field).length * 150, 600) }}
            columns={[
              {
                title: '#',
                width: 50,
                fixed: 'left',
                render: (_: unknown, __: unknown, idx: number) => idx + 1,
              },
              ...columns
                .filter(c => !c.is_system_field)
                .map(col => ({
                  title: col.is_primary_key
                    ? <span>{col.field_alias} <Tag color="blue" style={{ fontSize: 10 }}>PK</Tag></span>
                    : col.field_alias,
                  dataIndex: col.field_name,
                  key: col.field_name,
                  width: 150,
                  render: (_v: string | null, record: Record<string, unknown>) => {
                    const rowIdx = record.__idx as number;
                    return (
                      <Input
                        size="small"
                        placeholder={col.is_primary_key ? t('dataBrowse.batchInsertRequired') : ''}
                        value={batchRows[rowIdx]?.[col.field_name] ?? ''}
                        onChange={e => handleBatchCellChange(rowIdx, col.field_name, e.target.value || null)}
                      />
                    );
                  },
                })),
            ]}
          />
        </div>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Button type="dashed" onClick={handleAddMoreRows} icon={<PlusOutlined />}>
            {t('dataBrowse.addMoreRows')}
          </Button>
        </div>
      </Modal>

      {/* Diff Preview Modal (v2.1) */}
      <Modal
        title={t('dataBrowse.diffPreview')}
        open={diffModalOpen}
        onCancel={() => setDiffModalOpen(false)}
        onOk={handleConfirmSave}
        confirmLoading={saving}
        okText={t('dataBrowse.confirmSave')}
        cancelText={t('common.cancel')}
        width={700}
      >
        <p style={{ marginBottom: 12 }}>
          {t('dataBrowse.diffSummary', { count: diffData.length })}
        </p>
        <Table
          size="small"
          dataSource={diffData}
          rowKey={(r, i) => `${r.pk_key}_${r.field_name}_${i}`}
          pagination={false}
          scroll={{ y: 400 }}
          columns={[
            { title: t('dataBrowse.diffPkKey'), dataIndex: 'pk_key', width: 120, ellipsis: true },
            { title: t('dataBrowse.diffField'), dataIndex: 'field_alias', width: 120 },
            {
              title: t('dataBrowse.diffOldValue'),
              dataIndex: 'old_value',
              width: 180,
              render: (v: string | null) => (
                <span style={{ color: '#cf1322', background: '#fff1f0', padding: '1px 4px', borderRadius: 2 }}>
                  {v ?? <i style={{ color: '#ccc' }}>NULL</i>}
                </span>
              ),
            },
            {
              title: t('dataBrowse.diffNewValue'),
              dataIndex: 'new_value',
              width: 180,
              render: (v: string | null) => (
                <span style={{ color: '#389e0d', background: '#f6ffed', padding: '1px 4px', borderRadius: 2 }}>
                  {v ?? <i style={{ color: '#ccc' }}>NULL</i>}
                </span>
              ),
            },
          ]}
        />
      </Modal>

      {/* v3.0: AI Batch Fill Panel */}
      <AIBatchFillPanel
        open={batchFillOpen}
        onClose={() => setBatchFillOpen(false)}
        tableConfigId={tableConfigId}
        tableAlias={(tableInfo as { table_alias?: string }).table_alias || (tableInfo as { table_name?: string }).table_name}
      />

      {/* v4.4: AI Smart Fill Modal */}
      <AISmartFillModal
        open={smartFillOpen}
        onClose={() => setSmartFillOpen(false)}
        tableConfigId={tableConfigId}
        tableAlias={(tableInfo as { table_alias?: string }).table_alias || (tableInfo as { table_name?: string }).table_name}
        columns={columns.map(c => ({
          field_name: c.field_name,
          field_alias: c.field_alias,
          is_editable: !!c.is_editable,
          is_primary_key: !!c.is_primary_key,
          is_system_field: !!c.is_system_field,
        }))}
      />
    </div>
  );
}
