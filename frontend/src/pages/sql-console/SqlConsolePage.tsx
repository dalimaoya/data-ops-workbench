import { useState, useEffect, useCallback, useRef } from 'react';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';
import {
  Card, Select, Button, Table, message, Space, Tag, Alert, Segmented,
  Checkbox, Input, Collapse, Dropdown, InputNumber, Tooltip, Spin,
} from 'antd';
import {
  PlayCircleOutlined, DownloadOutlined, PlusOutlined,
  HistoryOutlined, RobotOutlined, CloseOutlined, FileExcelOutlined,
  FileTextOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import EditorImport from 'react-simple-code-editor';
// Handle both ESM default and CJS module.exports.default
const Editor = (EditorImport as any).default || EditorImport;
// @ts-ignore
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import 'prismjs/themes/prism-tomorrow.css';
import { api } from '../../api/request';
import { findFirstHealthyDs } from '../../utils/datasourceHelper';

const { TextArea } = Input;

// ── Types ──

interface ColumnInfo {
  name: string;
  type: string;
}

interface Condition {
  field: string;
  operator: string;
  value: string;
  value2: string; // for BETWEEN
}

interface SortItem {
  field: string;
  direction: 'ASC' | 'DESC';
}

interface QueryHistoryItem {
  id: string;
  sql: string;
  datasource_id: number;
  datasource_name: string;
  executed_at: string;
  row_count?: number;
  success: boolean;
  error?: string;
}

// ── Operators ──

const OPERATORS = [
  { value: '=', label: 'opEquals' },
  { value: '!=', label: 'opNotEquals' },
  { value: '>', label: 'opGt' },
  { value: '>=', label: 'opGte' },
  { value: '<', label: 'opLt' },
  { value: '<=', label: 'opLte' },
  { value: 'LIKE', label: 'opLike' },
  { value: 'NOT LIKE', label: 'opNotLike' },
  { value: 'IS NULL', label: 'opIsNull' },
  { value: 'IS NOT NULL', label: 'opIsNotNull' },
  { value: 'IN', label: 'opIn' },
  { value: 'BETWEEN', label: 'opBetween' },
];

const NO_VALUE_OPS = ['IS NULL', 'IS NOT NULL'];

// ── History helpers ──

const HISTORY_KEY = 'sql-console-history';
const MAX_HISTORY = 50;

function loadHistory(): QueryHistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(items: QueryHistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

function addHistory(item: Omit<QueryHistoryItem, 'id'>) {
  const items = loadHistory();
  items.unshift({ ...item, id: crypto.randomUUID() });
  saveHistory(items);
  return items.slice(0, MAX_HISTORY);
}

// ── SQL highlight ──

function highlightSql(code: string): string {
  return Prism.highlight(code, Prism.languages.sql, 'sql');
}

// ── Quote helper for visual builder ──

function quoteValue(val: string, op: string): string {
  if (op === 'IN') {
    const parts = val.split(',').map(v => {
      const trimmed = v.trim();
      if (/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
      return `'${trimmed}'`;
    });
    return `(${parts.join(', ')})`;
  }
  if (/^\d+(\.\d+)?$/.test(val)) return val;
  return `'${val}'`;
}

export default function SqlConsolePage() {
  const { t } = useTranslation();
  const { onlineStatus } = useDatasourceOnline();
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Shared state ──
  const [datasources, setDatasources] = useState<any[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | null>(null);
  const [sql, setSql] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [mode, setMode] = useState<string>('manual');

  // ── Visual builder state ──
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [sorts, setSorts] = useState<SortItem[]>([]);
  const [limitRows, setLimitRows] = useState<number>(1000);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);

  // ── AI state ──
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ sql: string; explanation: string } | null>(null);
  const [aiTable, setAiTable] = useState<string | null>(null);

  // ── History ──
  const [history, setHistory] = useState<QueryHistoryItem[]>(loadHistory);

  // ── Load datasources ──
  useEffect(() => {
    api.get('/datasource', { params: { page_size: 100 } }).then(res => {
      const raw = res.data;
      const items = Array.isArray(raw) ? raw : (raw.items || []);
      setDatasources(items);
      if (items.length > 0 && !selectedDs) {
        const healthy = findFirstHealthyDs(items, onlineStatus);
        if (healthy) setSelectedDs(healthy.id);
      }
    }).catch(() => {});
  }, []);

  // ── Check AI availability ──
  useEffect(() => {
    api.get('/sql-console/ai-available').then(res => {
      setAiAvailable(res.data?.available === true);
    }).catch(() => setAiAvailable(false));
  }, []);

  // ── Load tables when ds changes ──
  useEffect(() => {
    if (!selectedDs) { setTables([]); return; }
    setTablesLoading(true);
    api.get('/db-manager/tables', { params: { datasource_id: selectedDs } })
      .then(res => {
        const raw = res.data?.tables || [];
        setTables(raw.map((t: any) => typeof t === 'string' ? t : t.table_name || ''));
      })
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [selectedDs]);

  // ── Load columns when table changes ──
  const fetchColumns = useCallback(async (tableName: string) => {
    if (!selectedDs || !tableName) return;
    setColumnsLoading(true);
    try {
      const res = await api.get('/db-manager/table-structure', {
        params: { datasource_id: selectedDs, table_name: tableName },
      });
      const cols: ColumnInfo[] = (res.data?.columns || []).map((c: any) => ({
        name: c.name, type: c.type,
      }));
      setTableColumns(cols);
      setSelectedFields([]);
    } catch {
      setTableColumns([]);
    } finally {
      setColumnsLoading(false);
    }
  }, [selectedDs]);

  useEffect(() => {
    if (selectedTable) fetchColumns(selectedTable);
  }, [selectedTable, fetchColumns]);

  // ── Get datasource name ──
  const getDsName = (dsId: number) => {
    const ds = datasources.find(d => d.id === dsId);
    return ds ? `${ds.datasource_name} (${ds.db_type})` : String(dsId);
  };

  // ── Execute SQL ──
  const handleExecute = async (overrideSql?: string) => {
    const execSql = (overrideSql || sql).trim();
    if (!selectedDs || !execSql) {
      message.warning(t('sqlConsole.selectDatasource'));
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/sql-console/execute', {
        datasource_id: selectedDs,
        sql: execSql,
      });
      setResult(res.data);
      // Save to history
      setHistory(addHistory({
        sql: execSql,
        datasource_id: selectedDs,
        datasource_name: getDsName(selectedDs),
        executed_at: new Date().toISOString(),
        row_count: res.data?.row_count,
        success: true,
      }));
    } catch (e: any) {
      const errMsg = e?.response?.data?.detail || 'SQL error';
      message.error(errMsg);
      setHistory(addHistory({
        sql: execSql,
        datasource_id: selectedDs,
        datasource_name: getDsName(selectedDs),
        executed_at: new Date().toISOString(),
        success: false,
        error: errMsg,
      }));
    } finally {
      setLoading(false);
    }
  };

  // ── Export Excel ──
  const handleExportExcel = async () => {
    if (!selectedDs || !sql.trim()) return;
    setExportLoading(true);
    try {
      const res = await api.post('/sql-console/export', {
        datasource_id: selectedDs, sql: sql.trim(),
      }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'query_result.xlsx'; a.click();
      window.URL.revokeObjectURL(url);
    } catch { message.error('Export failed'); }
    finally { setExportLoading(false); }
  };

  // ── Export CSV ──
  const handleExportCsv = async () => {
    if (!selectedDs || !sql.trim()) return;
    setExportLoading(true);
    try {
      const res = await api.post('/sql-console/export-csv', {
        datasource_id: selectedDs, sql: sql.trim(),
      }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'query_result.csv'; a.click();
      window.URL.revokeObjectURL(url);
    } catch { message.error('Export failed'); }
    finally { setExportLoading(false); }
  };

  // ── Ctrl+Enter shortcut ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  };

  // ── Visual builder: generate SQL ──
  const generateSql = useCallback(() => {
    if (!selectedTable) return '';
    const fields = selectedFields.length > 0 ? selectedFields.join(', ') : '*';
    let query = `SELECT ${fields}\nFROM ${selectedTable}`;

    const whereParts: string[] = [];
    for (const c of conditions) {
      if (!c.field) continue;
      if (NO_VALUE_OPS.includes(c.operator)) {
        whereParts.push(`${c.field} ${c.operator}`);
      } else if (c.operator === 'BETWEEN') {
        if (c.value && c.value2) {
          whereParts.push(`${c.field} BETWEEN ${quoteValue(c.value, '=')} AND ${quoteValue(c.value2, '=')}`);
        }
      } else if (c.operator === 'LIKE' || c.operator === 'NOT LIKE') {
        if (c.value) whereParts.push(`${c.field} ${c.operator} '%${c.value}%'`);
      } else {
        if (c.value) whereParts.push(`${c.field} ${c.operator} ${quoteValue(c.value, c.operator)}`);
      }
    }
    if (whereParts.length > 0) {
      query += `\nWHERE ${whereParts.join('\n  AND ')}`;
    }

    if (sorts.length > 0) {
      const sortParts = sorts.filter(s => s.field).map(s => `${s.field} ${s.direction}`);
      if (sortParts.length > 0) query += `\nORDER BY ${sortParts.join(', ')}`;
    }

    query += `\nLIMIT ${limitRows}`;
    return query;
  }, [selectedTable, selectedFields, conditions, sorts, limitRows]);

  const handleGenerateAndFill = () => {
    const generated = generateSql();
    if (generated) {
      setSql(generated);
      setMode('manual');
    }
  };

  const handleGenerateAndExecute = () => {
    const generated = generateSql();
    if (generated) {
      setSql(generated);
      handleExecute(generated);
    }
  };

  // ── AI generate ──
  const handleAiGenerate = async () => {
    if (!selectedDs || !aiTable || !aiQuery.trim()) {
      message.warning(t('sqlConsole.selectTable'));
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await api.post('/sql-console/ai-generate', {
        datasource_id: selectedDs,
        table_name: aiTable,
        query_text: aiQuery.trim(),
      });
      setAiResult(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiUse = () => {
    if (aiResult?.sql) {
      setSql(aiResult.sql);
      setMode('manual');
    }
  };

  // ── History ──
  const handleClearHistory = () => {
    saveHistory([]);
    setHistory([]);
  };

  const handleRestoreHistory = (item: QueryHistoryItem) => {
    setSql(item.sql);
    if (item.datasource_id && datasources.some(d => d.id === item.datasource_id)) {
      setSelectedDs(item.datasource_id);
    }
    setMode('manual');
  };

  // ── Result table columns ──
  const resultColumns = result?.columns?.map((col: string) => ({
    title: col, dataIndex: col, key: col, ellipsis: true, width: 150,
  })) || [];

  const resultData = result?.rows?.map((row: string[], i: number) => {
    const obj: any = { _key: i };
    result.columns?.forEach((col: string, ci: number) => { obj[col] = row[ci]; });
    return obj;
  }) || [];

  // ── Mode tabs ──
  const modeOptions = [
    { label: t('sqlConsole.modeManual'), value: 'manual' },
    { label: t('sqlConsole.modeVisual'), value: 'visual' },
    { label: aiAvailable ? t('sqlConsole.modeAi') : `${t('sqlConsole.modeAi')}（${t('sqlConsole.aiNotConfigured')})`, value: 'ai', disabled: !aiAvailable },
  ];

  const exportMenuItems = [
    { key: 'excel', icon: <FileExcelOutlined />, label: t('sqlConsole.exportExcel'), onClick: handleExportExcel },
    { key: 'csv', icon: <FileTextOutlined />, label: t('sqlConsole.exportCsv'), onClick: handleExportCsv },
  ];

  return (
    <div onKeyDown={handleKeyDown}>
      <Card title={t('sqlConsole.title')}>
        <Alert message={t('sqlConsole.selectOnly')} type="info" showIcon style={{ marginBottom: 12 }} />

        {/* Datasource selector + execute + export */}
        <Space style={{ marginBottom: 12 }} wrap>
          <Select
            style={{ width: 300 }}
            value={selectedDs}
            onChange={setSelectedDs}
            placeholder={t('sqlConsole.selectDatasource')}
            showSearch
            filterOption={(input, option) => (option?.children as unknown as string || '').toLowerCase().includes(input.toLowerCase())}
          >
            {datasources.map(ds => {
              const offline = onlineStatus[String(ds.id)] === false;
              return (
                <Select.Option key={ds.id} value={ds.id} disabled={offline}>
                  {ds.datasource_name} ({ds.db_type}){offline ? ' ⚠ 离线' : ''}
                </Select.Option>
              );
            })}
          </Select>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => handleExecute()} loading={loading}>
            {loading ? t('sqlConsole.executing') : t('sqlConsole.execute')} (Ctrl+Enter)
          </Button>
          {result && (
            <Dropdown menu={{ items: exportMenuItems }} placement="bottomLeft">
              <Button icon={<DownloadOutlined />} loading={exportLoading}>
                {t('sqlConsole.exportResult')}
              </Button>
            </Dropdown>
          )}
        </Space>

        {/* Mode switch */}
        <div style={{ marginBottom: 12 }}>
          <Segmented options={modeOptions} value={mode} onChange={(v) => setMode(v as string)} />
        </div>

        {/* ── Manual SQL mode ── */}
        {mode === 'manual' && (
          <div
            ref={editorRef}
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#1e1e2e',
              minHeight: 150,
              maxHeight: 400,
              overflowY: 'auto',
            }}
            onKeyDown={handleKeyDown}
          >
            <Editor
              value={sql}
              onValueChange={setSql}
              highlight={highlightSql}
              padding={12}
              placeholder={t('sqlConsole.sqlPlaceholder')}
              style={{
                fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
                fontSize: 14,
                lineHeight: 1.6,
                minHeight: 150,
                color: '#cdd6f4',
                background: '#1e1e2e',
              }}
            />
          </div>
        )}

        {/* ── Visual builder mode ── */}
        {mode === 'visual' && (
          <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 }}>
            {/* Table selector */}
            <Space style={{ marginBottom: 12 }} wrap>
              <Select
                style={{ width: 260 }}
                value={selectedTable}
                onChange={v => { setSelectedTable(v); setConditions([]); setSorts([]); setSelectedFields([]); }}
                placeholder={t('sqlConsole.selectTable')}
                showSearch
                loading={tablesLoading}
                options={tables.map(tb => ({ value: tb, label: tb }))}
                allowClear
              />
            </Space>

            {selectedTable && tableColumns.length > 0 && (
              <>
                {/* Field selection */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('sqlConsole.selectFields')}</div>
                  <Spin spinning={columnsLoading}>
                    <Space wrap>
                      <Checkbox
                        indeterminate={selectedFields.length > 0 && selectedFields.length < tableColumns.length}
                        checked={selectedFields.length === tableColumns.length}
                        onChange={e => setSelectedFields(e.target.checked ? tableColumns.map(c => c.name) : [])}
                      >{t('sqlConsole.selectAll')}</Checkbox>
                      {tableColumns.map(col => (
                        <Checkbox
                          key={col.name}
                          checked={selectedFields.includes(col.name)}
                          onChange={e => {
                            if (e.target.checked) setSelectedFields([...selectedFields, col.name]);
                            else setSelectedFields(selectedFields.filter(f => f !== col.name));
                          }}
                        >
                          <Tooltip title={col.type}>{col.name}</Tooltip>
                        </Checkbox>
                      ))}
                    </Space>
                  </Spin>
                </div>

                {/* Conditions */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('sqlConsole.conditions')}</div>
                  {conditions.map((cond, i) => (
                    <Space key={i} style={{ marginBottom: 4 }} wrap>
                      <Select
                        style={{ width: 160 }}
                        value={cond.field || undefined}
                        onChange={v => { const c = [...conditions]; c[i].field = v; setConditions(c); }}
                        options={tableColumns.map(c => ({ value: c.name, label: c.name }))}
                        placeholder={t('sqlConsole.selectFields')}
                      />
                      <Select
                        style={{ width: 140 }}
                        value={cond.operator}
                        onChange={v => { const c = [...conditions]; c[i].operator = v; setConditions(c); }}
                        options={OPERATORS.map(op => ({ value: op.value, label: t(`sqlConsole.${op.label}`) }))}
                      />
                      {!NO_VALUE_OPS.includes(cond.operator) && (
                        <Input
                          style={{ width: 160 }}
                          value={cond.value}
                          onChange={e => { const c = [...conditions]; c[i].value = e.target.value; setConditions(c); }}
                          placeholder={cond.operator === 'IN' ? 'a,b,c' : 'value'}
                        />
                      )}
                      {cond.operator === 'BETWEEN' && (
                        <Input
                          style={{ width: 160 }}
                          value={cond.value2}
                          onChange={e => { const c = [...conditions]; c[i].value2 = e.target.value; setConditions(c); }}
                          placeholder="value2"
                        />
                      )}
                      <Button type="text" danger icon={<CloseOutlined />} onClick={() => setConditions(conditions.filter((_, j) => j !== i))} />
                    </Space>
                  ))}
                  <Button
                    type="dashed" size="small" icon={<PlusOutlined />}
                    onClick={() => setConditions([...conditions, { field: '', operator: '=', value: '', value2: '' }])}
                  >{t('sqlConsole.addCondition')}</Button>
                </div>

                {/* Sort */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('sqlConsole.sortBy')}</div>
                  {sorts.map((s, i) => (
                    <Space key={i} style={{ marginBottom: 4 }}>
                      <Select
                        style={{ width: 160 }}
                        value={s.field || undefined}
                        onChange={v => { const ss = [...sorts]; ss[i].field = v; setSorts(ss); }}
                        options={tableColumns.map(c => ({ value: c.name, label: c.name }))}
                      />
                      <Select
                        style={{ width: 100 }}
                        value={s.direction}
                        onChange={v => { const ss = [...sorts]; ss[i].direction = v; setSorts(ss); }}
                        options={[
                          { value: 'ASC', label: t('sqlConsole.ascending') },
                          { value: 'DESC', label: t('sqlConsole.descending') },
                        ]}
                      />
                      <Button type="text" danger icon={<CloseOutlined />} onClick={() => setSorts(sorts.filter((_, j) => j !== i))} />
                    </Space>
                  ))}
                  <Button
                    type="dashed" size="small" icon={<PlusOutlined />}
                    onClick={() => setSorts([...sorts, { field: '', direction: 'ASC' }])}
                  >{t('sqlConsole.addSort')}</Button>
                </div>

                {/* Limit */}
                <Space style={{ marginBottom: 12 }}>
                  <span style={{ fontWeight: 600 }}>{t('sqlConsole.limitRows')}:</span>
                  <InputNumber min={1} max={50000} value={limitRows} onChange={v => setLimitRows(v || 1000)} />
                </Space>

                {/* Generate / Execute */}
                <div>
                  <Space>
                    <Button icon={<CopyOutlined />} onClick={handleGenerateAndFill}>{t('sqlConsole.generateSql')}</Button>
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleGenerateAndExecute}>{t('sqlConsole.execute')}</Button>
                  </Space>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── AI mode ── */}
        {mode === 'ai' && (
          <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 }}>
            <Space style={{ marginBottom: 12 }} wrap>
              <Select
                style={{ width: 260 }}
                value={aiTable}
                onChange={setAiTable}
                placeholder={t('sqlConsole.selectTable')}
                showSearch
                loading={tablesLoading}
                options={tables.map(tb => ({ value: tb, label: tb }))}
                allowClear
              />
            </Space>
            <TextArea
              rows={3}
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              placeholder={t('sqlConsole.aiPlaceholder')}
              style={{ marginBottom: 12 }}
            />
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={handleAiGenerate}
              loading={aiLoading}
              disabled={!aiTable || !aiQuery.trim()}
            >
              {aiLoading ? t('sqlConsole.aiGenerating') : t('sqlConsole.aiGenerate')}
            </Button>

            {aiResult && (
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8, padding: 12 }}>
                <pre style={{
                  background: '#1e1e2e', color: '#cdd6f4', padding: 12, borderRadius: 6,
                  fontFamily: '"Fira Code", monospace', fontSize: 13, overflow: 'auto', maxHeight: 200,
                  margin: '0 0 8px 0',
                }}>{aiResult.sql}</pre>
                {aiResult.explanation && (
                  <div style={{ marginBottom: 8 }}>
                    <Tag color="blue">{t('sqlConsole.aiExplanation')}</Tag>
                    <span style={{ color: '#666' }}>{aiResult.explanation}</span>
                  </div>
                )}
                <Space>
                  <Button type="primary" onClick={handleAiUse}>{t('sqlConsole.aiUseThis')}</Button>
                  <Button onClick={() => { setSql(aiResult.sql); setMode('manual'); handleExecute(aiResult.sql); }}>
                    {t('sqlConsole.execute')}
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}

        {/* ── Result table ── */}
        {result && (
          <div style={{ marginTop: 16 }}>
            <Space style={{ marginBottom: 8 }}>
              <Tag color="blue">{t('sqlConsole.rowCount')}: {result.row_count}</Tag>
              {result.truncated && <Tag color="orange">{t('sqlConsole.truncated')}</Tag>}
            </Space>
            <Table
              columns={resultColumns}
              dataSource={resultData}
              rowKey="_key"
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 50, showSizeChanger: true }}
            />
          </div>
        )}

        {/* ── Query history ── */}
        <Collapse
          ghost
          style={{ marginTop: 16 }}
          items={[{
            key: 'history',
            label: (
              <Space>
                <HistoryOutlined />
                {t('sqlConsole.history')} ({history.length})
              </Space>
            ),
            extra: history.length > 0 ? (
              <Button
                type="link" size="small" danger
                onClick={e => { e.stopPropagation(); handleClearHistory(); }}
              >
                {t('sqlConsole.clearHistory')}
              </Button>
            ) : undefined,
            children: history.length === 0 ? (
              <div style={{ color: '#999', padding: 16, textAlign: 'center' }}>{t('sqlConsole.noHistory')}</div>
            ) : (
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                {history.map(item => (
                  <div
                    key={item.id}
                    style={{
                      padding: '8px 12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                      background: item.success ? 'transparent' : '#fff2f0',
                    }}
                    onClick={() => handleRestoreHistory(item)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={8}>
                        <Tag color={item.success ? 'green' : 'red'} style={{ margin: 0 }}>
                          {item.success ? (item.row_count !== undefined ? `${item.row_count} rows` : 'OK') : 'ERR'}
                        </Tag>
                        <span style={{ color: '#999', fontSize: 12 }}>{item.datasource_name}</span>
                      </Space>
                      <span style={{ color: '#bbb', fontSize: 11 }}>
                        {new Date(item.executed_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{
                      fontFamily: 'monospace', fontSize: 12, color: '#555',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2,
                    }}>
                      {item.sql.substring(0, 120)}
                    </div>
                  </div>
                ))}
              </div>
            ),
          }]}
        />
      </Card>
    </div>
  );
}
