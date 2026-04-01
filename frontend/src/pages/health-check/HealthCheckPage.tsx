import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Table, Tag, Space, Statistic, Row, Col, Modal, Form, InputNumber, Switch,
  message, Tabs, Select, Empty,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, InfoCircleOutlined,
  ReloadOutlined, SettingOutlined, MedicineBoxOutlined,
} from '@ant-design/icons';
import { runHealthCheck, getHealthCheckHistory, getHealthCheckConfig, updateHealthCheckConfig } from '../../api/healthCheck';
import { useTranslation } from 'react-i18next';

const statusIcon: Record<string, React.ReactNode> = {
  ok: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  error: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  warning: <WarningOutlined style={{ color: '#faad14' }} />,
  info: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
};

const statusColor: Record<string, string> = {
  ok: 'success',
  error: 'error',
  warning: 'warning',
  info: 'processing',
};

const checkItemLabel: Record<string, string> = {
  connection: '连接测试',
  table_exists: '源表存在',
  structure: '表结构',
  response_time: '响应时间',
  row_count: '数据行数',
};

export default function HealthCheckPage() {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [latestResult, setLatestResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [_config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [form] = Form.useForm();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const fetchHistory = useCallback(async (page = 1) => {
    setHistoryLoading(true);
    try {
      const res = await getHealthCheckHistory({ page, page_size: 20, check_status: statusFilter });
      setHistory(res.data.items || []);
      setHistoryTotal(res.data.total || 0);
    } catch { /* ignore */ } finally {
      setHistoryLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await runHealthCheck();
      setLatestResult(res.data);
      message.success(t('healthCheck.runSuccess'));
      fetchHistory();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('common.failed'));
    } finally {
      setRunning(false);
    }
  };

  const openConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await getHealthCheckConfig();
      setConfig(res.data);
      form.setFieldsValue(res.data);
    } catch { /* ignore */ } finally {
      setConfigLoading(false);
      setConfigOpen(true);
    }
  };

  const saveConfig = async () => {
    const values = form.getFieldsValue();
    try {
      await updateHealthCheckConfig(values);
      message.success(t('healthCheck.configSaved'));
      setConfigOpen(false);
    } catch { message.error(t('common.failed')); }
  };

  // Overview stats from latest result
  const overview = latestResult ? {
    datasources: latestResult.datasource_count || 0,
    total: latestResult.total_checks || 0,
    errors: latestResult.errors || 0,
    warnings: latestResult.warnings || 0,
    ok: (latestResult.total_checks || 0) - (latestResult.errors || 0) - (latestResult.warnings || 0),
  } : null;

  const historyColumns = [
    {
      title: t('healthCheck.checkItem'),
      dataIndex: 'check_item',
      width: 120,
      render: (v: string) => checkItemLabel[v] || v,
    },
    {
      title: t('healthCheck.datasource'),
      dataIndex: 'datasource_name',
      width: 150,
    },
    {
      title: t('healthCheck.tableName'),
      dataIndex: 'table_name',
      width: 150,
      render: (v: string) => v || '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'check_status',
      width: 100,
      render: (v: string) => (
        <Tag icon={statusIcon[v]} color={statusColor[v]}>
          {v === 'ok' ? t('healthCheck.ok') : v === 'error' ? t('healthCheck.error') : v === 'warning' ? t('healthCheck.warning') : t('healthCheck.info')}
        </Tag>
      ),
    },
    {
      title: t('healthCheck.message'),
      dataIndex: 'check_message',
      ellipsis: true,
    },
    {
      title: t('healthCheck.responseTime'),
      dataIndex: 'response_time_ms',
      width: 120,
      render: (v: number) => v != null ? `${v}ms` : '-',
    },
    {
      title: t('common.time'),
      dataIndex: 'created_at',
      width: 180,
    },
  ];

  const resultColumns = [
    { title: t('healthCheck.datasource'), dataIndex: 'datasource_name', width: 150 },
    { title: t('healthCheck.tableName'), dataIndex: 'table_name', width: 150, render: (v: string) => v || '-' },
    { title: t('healthCheck.checkItem'), dataIndex: 'check_item', width: 120, render: (v: string) => checkItemLabel[v] || v },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag icon={statusIcon[v]} color={statusColor[v]}>{v}</Tag>,
    },
    { title: t('healthCheck.message'), dataIndex: 'message', ellipsis: true },
    { title: t('healthCheck.responseTime'), dataIndex: 'response_time_ms', width: 100, render: (v: number) => v != null ? `${v}ms` : '-' },
  ];

  return (
    <Card title={<span><MedicineBoxOutlined /> {t('healthCheck.title')}</span>}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<ReloadOutlined />} loading={running} onClick={handleRun}>
          {t('healthCheck.runNow')}
        </Button>
        <Button icon={<SettingOutlined />} onClick={openConfig}>
          {t('healthCheck.config')}
        </Button>
      </Space>

      {/* Overview stats */}
      {overview && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title={t('healthCheck.datasourceCount')} value={overview.datasources} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title={t('healthCheck.normalCount')} value={overview.ok} valueStyle={{ color: '#3f8600' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title={t('healthCheck.warningCount')} value={overview.warnings} valueStyle={{ color: '#cf1322' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title={t('healthCheck.errorCount')} value={overview.errors} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        </Row>
      )}

      <Tabs items={[
        {
          key: 'latest',
          label: t('healthCheck.latestResult'),
          children: latestResult ? (
            <Table
              dataSource={latestResult.results || []}
              columns={resultColumns}
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={false}
            />
          ) : <Empty description={t('healthCheck.noResult')} />,
        },
        {
          key: 'history',
          label: t('healthCheck.history'),
          children: (
            <div>
              <Space style={{ marginBottom: 8 }}>
                <Select
                  style={{ width: 150 }}
                  placeholder={t('healthCheck.filterStatus')}
                  allowClear
                  value={statusFilter}
                  onChange={v => { setStatusFilter(v); setHistoryPage(1); }}
                  options={[
                    { label: t('healthCheck.ok'), value: 'ok' },
                    { label: t('healthCheck.warning'), value: 'warning' },
                    { label: t('healthCheck.error'), value: 'error' },
                  ]}
                />
              </Space>
              <Table
                loading={historyLoading}
                dataSource={history}
                columns={historyColumns}
                rowKey="id"
                size="small"
                pagination={{
                  current: historyPage,
                  total: historyTotal,
                  pageSize: 20,
                  onChange: p => { setHistoryPage(p); fetchHistory(p); },
                }}
              />
            </div>
          ),
        },
      ]} />

      {/* Config modal */}
      <Modal
        title={t('healthCheck.configTitle')}
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={saveConfig}
        confirmLoading={configLoading}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="check_interval_minutes" label={t('healthCheck.interval')}>
            <InputNumber min={5} max={1440} addonAfter="min" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="auto_check_enabled" label={t('healthCheck.autoCheck')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notify_on_error" label={t('healthCheck.notifyOnError')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="slow_threshold_ms" label={t('healthCheck.slowThreshold')}>
            <InputNumber min={1000} max={60000} addonAfter="ms" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
