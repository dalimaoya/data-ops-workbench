import { useState, useEffect } from 'react';
import { Card, Tabs, DatePicker, Select, Button, Space, Descriptions, Tag, Table, Alert, Spin, Input, Empty } from 'antd';
import { RobotOutlined, SearchOutlined, WarningOutlined, FileSearchOutlined } from '@ant-design/icons';
import { logAnalyze } from '../../api/aiLogAnalyze';
import { api } from '../../api/request';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function AILogAnalysis() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(24, 'hour'),
    dayjs(),
  ]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [tables, setTables] = useState<{ id: number; name: string }[]>([]);
  const [activeTab, setActiveTab] = useState('summary');
  const [result, setResult] = useState<any>(null);

  // Trace fields
  const [traceField, setTraceField] = useState('');
  const [tracePk, setTracePk] = useState('');

  useEffect(() => {
    api.get('/table-config', { params: { page_size: 200 } }).then(res => {
      const items = res.data.items || res.data;
      setTables(Array.isArray(items) ? items.map((t: any) => ({ id: t.id, name: t.table_alias || t.table_name })) : []);
    }).catch(() => {});
  }, []);

  const doAnalyze = async (action?: string) => {
    const act = action || activeTab;
    setLoading(true);
    setResult(null);
    try {
      const res = await logAnalyze({
        action: act as any,
        time_range: {
          start: timeRange[0].format('YYYY-MM-DDTHH:mm:ss'),
          end: timeRange[1].format('YYYY-MM-DDTHH:mm:ss'),
        },
        table_id: tableId,
        field_name: act === 'trace' ? traceField || undefined : undefined,
        row_pk: act === 'trace' ? tracePk || undefined : undefined,
      });
      setResult(res.data);
    } catch (e: any) {
      setResult({ error: e?.response?.data?.detail || t('common.failed') });
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setResult(null);
  };

  // Render summary
  const renderSummary = () => {
    if (!result?.data) return null;
    const { summary_text, stats } = result.data;
    return (
      <div>
        <Card size="small" style={{ marginBottom: 16, background: '#f6ffed' }}>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{summary_text}</pre>
        </Card>
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label={t('aiLog.systemOps')}>{stats?.system_ops || 0}</Descriptions.Item>
          <Descriptions.Item label={t('aiLog.imports')}>{stats?.imports || 0}</Descriptions.Item>
          <Descriptions.Item label={t('aiLog.writebacks')}>{stats?.writebacks || 0}</Descriptions.Item>
          <Descriptions.Item label={t('aiLog.rollbacks')}>{stats?.rollbacks || 0}</Descriptions.Item>
          <Descriptions.Item label={t('aiLog.updatedRows')}>{stats?.updated_rows || 0}</Descriptions.Item>
          <Descriptions.Item label={t('aiLog.insertedRows')}>{stats?.inserted_rows || 0}</Descriptions.Item>
          <Descriptions.Item label={t('aiLog.deletedRows')}>{stats?.deleted_rows || 0}</Descriptions.Item>
        </Descriptions>
      </div>
    );
  };

  // Render anomalies
  const renderAnomalies = () => {
    if (!result?.data) return null;
    const { anomalies } = result.data;
    if (!anomalies?.length) return <Empty description={t('aiLog.noAnomalies')} />;
    const levelColor: Record<string, string> = { error: 'red', warning: 'orange', info: 'blue' };
    const columns = [
      {
        title: t('aiLog.riskLevel'),
        dataIndex: 'level',
        width: 100,
        render: (v: string) => <Tag color={levelColor[v] || 'default'}>{v === 'error' ? '🔴 ' + t('aiLog.high') : v === 'warning' ? '🟡 ' + t('aiLog.medium') : '🔵 ' + t('aiLog.low')}</Tag>,
      },
      { title: t('aiLog.anomalyType'), dataIndex: 'type', width: 150, render: (v: string) => t(`aiLog.anomalyType_${v}`, v) },
      { title: t('aiLog.description'), dataIndex: 'message' },
    ];
    return <Table dataSource={anomalies} columns={columns} rowKey={(_, i) => String(i)} size="small" pagination={false} />;
  };

  // Render trace
  const renderTrace = () => {
    if (!result?.data) return null;
    const { traces } = result.data;
    if (!traces?.length) return <Empty description={t('aiLog.noTraceResults')} />;
    const columns = [
      { title: t('aiLog.operator'), dataIndex: 'operator_user', width: 100 },
      { title: t('aiLog.operateTime'), dataIndex: 'operator_time', width: 180 },
      { title: t('aiLog.fieldName'), dataIndex: 'field_name', width: 120 },
      { title: t('aiLog.rowPk'), dataIndex: 'row_pk_value', width: 120 },
      { title: t('aiLog.oldValue'), dataIndex: 'old_value', width: 150, ellipsis: true },
      { title: t('aiLog.newValue'), dataIndex: 'new_value', width: 150, ellipsis: true },
      { title: t('aiLog.changeType'), dataIndex: 'change_type', width: 80, render: (v: string) => <Tag>{v}</Tag> },
    ];
    return <Table dataSource={traces} columns={columns} rowKey={(_, i) => String(i)} size="small" pagination={{ pageSize: 20 }} />;
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker
          showTime
          value={timeRange}
          onChange={(v) => v && setTimeRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
        />
        <Select
          style={{ width: 200 }}
          placeholder={t('aiLog.selectTable')}
          allowClear
          value={tableId}
          onChange={setTableId}
          options={tables.map(t => ({ label: t.name, value: t.id }))}
        />
        {activeTab === 'trace' && (
          <>
            <Input placeholder={t('aiLog.fieldNamePlaceholder')} value={traceField} onChange={e => setTraceField(e.target.value)} style={{ width: 140 }} />
            <Input placeholder={t('aiLog.rowPkPlaceholder')} value={tracePk} onChange={e => setTracePk(e.target.value)} style={{ width: 140 }} />
          </>
        )}
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => doAnalyze()}>
          {t('aiLog.analyze')}
        </Button>
      </Space>

      <Tabs activeKey={activeTab} onChange={handleTabChange} items={[
        {
          key: 'summary',
          label: <span><RobotOutlined /> {t('aiLog.summary')}</span>,
          children: <Spin spinning={loading}>{result?.error ? <Alert type="error" message={result.error} /> : renderSummary()}</Spin>,
        },
        {
          key: 'anomaly',
          label: <span><WarningOutlined /> {t('aiLog.anomalyDetection')}</span>,
          children: <Spin spinning={loading}>{result?.error ? <Alert type="error" message={result.error} /> : renderAnomalies()}</Spin>,
        },
        {
          key: 'trace',
          label: <span><FileSearchOutlined /> {t('aiLog.trace')}</span>,
          children: <Spin spinning={loading}>{result?.error ? <Alert type="error" message={result.error} /> : renderTrace()}</Spin>,
        },
      ]} />
    </div>
  );
}
