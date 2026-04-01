import { useState, useEffect } from 'react';
import {
  Card, Table, Button, Space, Tag, Switch, Modal, Form, Input, Select, InputNumber,
  message, Popconfirm, Timeline, Badge, Tabs,
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, DeleteOutlined, EditOutlined,
  HistoryOutlined, ClockCircleOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  listScheduledTasks, createScheduledTask, updateScheduledTask,
  deleteScheduledTask, runTaskNow, getTaskHistory, getAllExecutionLogs,
} from '../../api/scheduler';
import type { ScheduledTask, TaskExecution, ScheduleConfig, ExecutionLogItem } from '../../api/scheduler';
import { formatBeijingTime } from '../../utils/formatTime';

const TASK_TYPES = [
  { value: 'health_check', labelKey: 'scheduler.typeHealthCheck' },
  { value: 'platform_backup', labelKey: 'scheduler.typePlatformBackup' },
  { value: 'data_export', labelKey: 'scheduler.typeDataExport' },
];

function formatSchedule(schedule: ScheduleConfig, t: (k: string) => string): string {
  if (schedule.type === 'interval') {
    const parts: string[] = [];
    if (schedule.days) parts.push(`${schedule.days} ${t('scheduler.days')}`);
    if (schedule.hours) parts.push(`${schedule.hours} ${t('scheduler.hours')}`);
    if (schedule.minutes) parts.push(`${schedule.minutes} ${t('scheduler.minutes')}`);
    return `${t('scheduler.every')} ${parts.join(' ')}`;
  }
  // cron
  const h = schedule.hour ?? '*';
  const m = schedule.minute ?? '0';
  const dow = schedule.day_of_week || '*';
  if (dow !== '*') {
    return `${t('scheduler.weekly')} ${dow} ${h}:${String(m).padStart(2, '0')}`;
  }
  return `${t('scheduler.daily')} ${h}:${String(m).padStart(2, '0')}`;
}

export default function SchedulerPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTask, setHistoryTask] = useState<{ id: number; name: string } | null>(null);
  const [history, setHistory] = useState<TaskExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState('tasks');

  // Execution logs
  const [execLogs, setExecLogs] = useState<ExecutionLogItem[]>([]);
  const [execLogsTotal, setExecLogsTotal] = useState(0);
  const [execLogsPage, setExecLogsPage] = useState(1);
  const [execLogsLoading, setExecLogsLoading] = useState(false);

  const fetchExecLogs = async (p: number = execLogsPage) => {
    setExecLogsLoading(true);
    try {
      const res = await getAllExecutionLogs({ page: p, page_size: 20 });
      setExecLogs(res.data.items);
      setExecLogsTotal(res.data.total);
    } catch {
      message.error(t('scheduler.historyLoadFailed'));
    } finally {
      setExecLogsLoading(false);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await listScheduledTasks({ page, page_size: 20 });
      setTasks(res.data.items);
      setTotal(res.data.total);
    } catch {
      message.error(t('scheduler.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, [page]);
  useEffect(() => { if (activeTab === 'logs') fetchExecLogs(execLogsPage); }, [execLogsPage, activeTab]);

  const handleCreate = () => {
    setEditingTask(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'health_check',
      schedule_type: 'cron',
      enabled: true,
      hour: 6,
      minute: 0,
    });
    setModalOpen(true);
  };

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    const s = task.schedule || {};
    form.setFieldsValue({
      name: task.name,
      type: task.type,
      schedule_type: s.type || 'cron',
      enabled: task.enabled,
      hour: s.hour,
      minute: s.minute,
      day_of_week: s.day_of_week,
      interval_minutes: s.minutes,
      interval_hours: s.hours,
      interval_days: s.days,
      config_table_id: task.config?.table_config_id,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const schedule: ScheduleConfig = { type: values.schedule_type };
      if (values.schedule_type === 'cron') {
        if (values.hour !== undefined) schedule.hour = values.hour;
        if (values.minute !== undefined) schedule.minute = values.minute;
        if (values.day_of_week) schedule.day_of_week = values.day_of_week;
      } else {
        if (values.interval_minutes) schedule.minutes = values.interval_minutes;
        if (values.interval_hours) schedule.hours = values.interval_hours;
        if (values.interval_days) schedule.days = values.interval_days;
      }

      const config: Record<string, any> = {};
      if (values.type === 'data_export' && values.config_table_id) {
        config.table_config_id = values.config_table_id;
      }

      const payload = {
        name: values.name,
        type: values.type,
        schedule,
        enabled: values.enabled,
        config,
      };

      if (editingTask) {
        await updateScheduledTask(editingTask.id, payload);
        message.success(t('scheduler.updateSuccess'));
      } else {
        await createScheduledTask(payload);
        message.success(t('scheduler.createSuccess'));
      }
      setModalOpen(false);
      fetchTasks();
    } catch (e: any) {
      if (e?.response?.data?.detail) message.error(e.response.data.detail);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (task: ScheduledTask, enabled: boolean) => {
    try {
      await updateScheduledTask(task.id, { enabled });
      message.success(enabled ? t('common.enabled') : t('common.disabled'));
      fetchTasks();
    } catch {
      message.error(t('common.failed'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteScheduledTask(id);
      message.success(t('scheduler.deleteSuccess'));
      fetchTasks();
    } catch {
      message.error(t('common.failed'));
    }
  };

  const handleRunNow = async (id: number) => {
    try {
      await runTaskNow(id);
      message.success(t('scheduler.runStarted'));
      setTimeout(fetchTasks, 2000);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('common.failed'));
    }
  };

  const handleShowHistory = async (task: ScheduledTask) => {
    setHistoryTask({ id: task.id, name: task.name });
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await getTaskHistory(task.id, { page_size: 50 });
      setHistory(res.data.items);
    } catch {
      message.error(t('scheduler.historyLoadFailed'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const taskTypeLabel = (type: string) => {
    const found = TASK_TYPES.find(tt => tt.value === type);
    return found ? t(found.labelKey) : type;
  };

  const columns = [
    {
      title: t('scheduler.taskName'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: t('common.type'),
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string) => {
        const colorMap: Record<string, string> = {
          health_check: 'green',
          platform_backup: 'blue',
          data_export: 'orange',
        };
        return <Tag color={colorMap[type] || 'default'}>{taskTypeLabel(type)}</Tag>;
      },
    },
    {
      title: t('scheduler.frequency'),
      key: 'schedule',
      width: 180,
      render: (_: any, record: ScheduledTask) =>
        record.schedule ? formatSchedule(record.schedule, t) : '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, record: ScheduledTask) => (
        <Switch
          checked={enabled}
          size="small"
          onChange={(val) => handleToggle(record, val)}
        />
      ),
    },
    {
      title: t('scheduler.lastRun'),
      dataIndex: 'last_run',
      key: 'last_run',
      width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: t('scheduler.nextRun'),
      dataIndex: 'next_run',
      key: 'next_run',
      width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 240,
      render: (_: any, record: ScheduledTask) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => handleRunNow(record.id)}
          >
            {t('scheduler.runNow')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => handleShowHistory(record)}
          />
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('common.confirmDelete')}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const scheduleType = Form.useWatch('schedule_type', form);
  const taskType = Form.useWatch('type', form);

  // Execution log columns
  const execLogColumns = [
    {
      title: t('scheduler.taskName'),
      dataIndex: 'task_name',
      key: 'task_name',
      width: 180,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const map: Record<string, { color: string; text: string }> = {
          success: { color: 'green', text: t('scheduler.statusSuccess') },
          failed: { color: 'red', text: t('scheduler.statusFailed') },
          running: { color: 'blue', text: t('scheduler.statusRunning') },
        };
        const info = map[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: t('scheduler.startedAt', '开始时间'),
      dataIndex: 'started_at',
      key: 'started_at',
      width: 180,
      render: (v: string) => formatBeijingTime(v),
    },
    {
      title: t('scheduler.finishedAt', '结束时间'),
      dataIndex: 'finished_at',
      key: 'finished_at',
      width: 180,
      render: (v: string) => formatBeijingTime(v),
    },
    {
      title: t('scheduler.resultSummary', '结果摘要'),
      dataIndex: 'result_summary',
      key: 'result_summary',
      ellipsis: true,
    },
    {
      title: t('scheduler.errorMessage', '错误信息'),
      dataIndex: 'error_message',
      key: 'error_message',
      ellipsis: true,
      render: (v: string) => v ? <span style={{ color: '#ff4d4f' }}>{v}</span> : '-',
    },
  ];

  return (
    <>
      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            {t('scheduler.title')}
          </Space>
        }
        extra={
          activeTab === 'tasks' ? (
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchTasks}>{t('common.refresh')}</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                {t('scheduler.createTask')}
              </Button>
            </Space>
          ) : (
            <Button icon={<ReloadOutlined />} onClick={() => fetchExecLogs(execLogsPage)}>{t('common.refresh')}</Button>
          )
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'tasks',
              label: t('scheduler.taskList', '任务列表'),
              children: (
                <Table
                  columns={columns}
                  dataSource={tasks}
                  rowKey="id"
                  loading={loading}
                  pagination={{
                    current: page,
                    total,
                    pageSize: 20,
                    onChange: setPage,
                    showTotal: (t) => `${t}`,
                  }}
                  size="middle"
                />
              ),
            },
            {
              key: 'logs',
              label: t('scheduler.executionLogs', '执行日志'),
              children: (
                <Table
                  columns={execLogColumns}
                  dataSource={execLogs}
                  rowKey="id"
                  loading={execLogsLoading}
                  pagination={{
                    current: execLogsPage,
                    total: execLogsTotal,
                    pageSize: 20,
                    onChange: setExecLogsPage,
                    showTotal: (t) => `${t}`,
                  }}
                  size="middle"
                />
              ),
            },
          ]}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingTask ? t('scheduler.editTask') : t('scheduler.createTask')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('scheduler.taskName')} rules={[{ required: true, message: t('scheduler.nameRequired') }]}>
            <Input placeholder={t('scheduler.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="type" label={t('common.type')} rules={[{ required: true }]}>
            <Select>
              {TASK_TYPES.map(tt => (
                <Select.Option key={tt.value} value={tt.value}>{t(tt.labelKey)}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="schedule_type" label={t('scheduler.scheduleType')} rules={[{ required: true }]}>
            <Select>
              <Select.Option value="cron">{t('scheduler.cron')}</Select.Option>
              <Select.Option value="interval">{t('scheduler.interval')}</Select.Option>
            </Select>
          </Form.Item>
          {scheduleType === 'cron' && (
            <Space style={{ width: '100%' }} wrap>
              <Form.Item name="hour" label={t('scheduler.hour')}>
                <InputNumber min={0} max={23} style={{ width: 80 }} />
              </Form.Item>
              <Form.Item name="minute" label={t('scheduler.minute')}>
                <InputNumber min={0} max={59} style={{ width: 80 }} />
              </Form.Item>
              <Form.Item name="day_of_week" label={t('scheduler.dayOfWeek')}>
                <Input placeholder="mon-fri" style={{ width: 120 }} />
              </Form.Item>
            </Space>
          )}
          {scheduleType === 'interval' && (
            <Space style={{ width: '100%' }} wrap>
              <Form.Item name="interval_days" label={t('scheduler.days')}>
                <InputNumber min={0} style={{ width: 80 }} />
              </Form.Item>
              <Form.Item name="interval_hours" label={t('scheduler.hours')}>
                <InputNumber min={0} max={23} style={{ width: 80 }} />
              </Form.Item>
              <Form.Item name="interval_minutes" label={t('scheduler.minutes')}>
                <InputNumber min={0} max={59} style={{ width: 80 }} />
              </Form.Item>
            </Space>
          )}
          {taskType === 'data_export' && (
            <Form.Item name="config_table_id" label={t('scheduler.tableConfigId')}>
              <InputNumber style={{ width: '100%' }} placeholder={t('scheduler.tableConfigIdPlaceholder')} />
            </Form.Item>
          )}
          <Form.Item name="enabled" label={t('common.status')} valuePropName="checked">
            <Switch checkedChildren={t('common.enabled')} unCheckedChildren={t('common.disabled')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* History Modal */}
      <Modal
        title={`${t('scheduler.executionHistory')} — ${historyTask?.name || ''}`}
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={640}
      >
        {historyLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>{t('common.loading')}</div>
        ) : history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>{t('common.noData')}</div>
        ) : (
          <Timeline
            items={history.map(h => ({
              color: h.status === 'success' ? 'green' : h.status === 'failed' ? 'red' : 'blue',
              children: (
                <div>
                  <Space>
                    <Badge
                      status={h.status === 'success' ? 'success' : h.status === 'failed' ? 'error' : 'processing'}
                      text={h.status === 'success' ? t('scheduler.statusSuccess') : h.status === 'failed' ? t('scheduler.statusFailed') : t('scheduler.statusRunning')}
                    />
                    <span style={{ color: '#999', fontSize: 12 }}>
                      {h.started_at ? new Date(h.started_at).toLocaleString() : ''}
                      {h.finished_at ? ` → ${new Date(h.finished_at).toLocaleTimeString()}` : ''}
                    </span>
                  </Space>
                  {h.result_summary && (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{h.result_summary}</div>
                  )}
                  {h.error_message && (
                    <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 4 }}>{h.error_message}</div>
                  )}
                </div>
              ),
            }))}
          />
        )}
      </Modal>
    </>
  );
}
