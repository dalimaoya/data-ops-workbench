import { useState, useEffect } from 'react';
import {
  Card, Tabs, Table, Button, Modal, Form, Input, Select, Switch, Space, Tag,
  Checkbox, message, Popconfirm, Spin,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SendOutlined, EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

const CHANNEL_TYPE_OPTIONS = [
  { label: '企业微信机器人', value: 'wechat_bot' },
  { label: '钉钉机器人', value: 'dingtalk_bot' },
  { label: '邮件', value: 'email' },
  { label: 'Webhook', value: 'webhook' },
];

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  wechat_bot: '企微机器人',
  dingtalk_bot: '钉钉机器人',
  email: '邮件',
  webhook: 'Webhook',
};

const CHANNEL_TYPE_COLORS: Record<string, string> = {
  wechat_bot: 'green',
  dingtalk_bot: 'blue',
  email: 'orange',
  webhook: 'purple',
};

const EVENT_LABELS: Record<string, string> = {
  writeback: '数据回写',
  export: '数据导出',
  import: '数据导入',
  approval: '审批事件',
  user_change: '用户变更',
  health_alert: '健康告警',
};

interface ChannelItem {
  id: number;
  channel_type: string;
  name: string;
  config: Record<string, any>;
  enabled: boolean;
  created_at: string | null;
}

interface LogItem {
  id: number;
  channel_id: number;
  channel_name: string;
  channel_type: string;
  event_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
}

export default function NotificationPushPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('channels');

  // Channels
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);
  const [channelForm] = Form.useForm();
  const [channelType, setChannelType] = useState('wechat_bot');

  // Subscriptions
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [subscriptions, setSubscriptions] = useState<Record<number, string[]>>({});
  const [subLoading, setSubLoading] = useState(false);
  const [subSaving, setSubSaving] = useState(false);

  // Logs
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // ── Channels ──
  const fetchChannels = async () => {
    setChannelLoading(true);
    try {
      const res = await api.get('/notification-push/channels');
      setChannels(res.data.items || []);
    } catch { /* ignore */ } finally {
      setChannelLoading(false);
    }
  };

  const handleSaveChannel = async () => {
    const values = await channelForm.validateFields();
    const config: Record<string, any> = {};
    if (values.channel_type === 'wechat_bot' || values.channel_type === 'dingtalk_bot') {
      config.webhook_url = values.webhook_url;
    } else if (values.channel_type === 'email') {
      config.smtp_host = values.smtp_host;
      config.smtp_port = values.smtp_port || 465;
      config.smtp_username = values.smtp_username;
      if (values.smtp_password) config.smtp_password = values.smtp_password;
      config.smtp_from_email = values.smtp_from_email;
      config.smtp_to_emails = values.smtp_to_emails;
      config.smtp_use_ssl = values.smtp_use_ssl ?? true;
    } else if (values.channel_type === 'webhook') {
      config.url = values.webhook_url;
      config.secret = values.webhook_secret || '';
    }
    try {
      if (editingChannelId) {
        await api.put(`/notification-push/channels/${editingChannelId}`, {
          name: values.name, config, enabled: values.enabled ?? true,
        });
      } else {
        await api.post('/notification-push/channels', {
          channel_type: values.channel_type, name: values.name, config, enabled: values.enabled ?? true,
        });
      }
      message.success(editingChannelId ? '渠道已更新' : '渠道已添加');
      setChannelModalOpen(false);
      channelForm.resetFields();
      setEditingChannelId(null);
      fetchChannels();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const handleDeleteChannel = async (id: number) => {
    try {
      await api.delete(`/notification-push/channels/${id}`);
      message.success('渠道已删除');
      fetchChannels();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const handleTestChannel = async (id: number) => {
    try {
      const res = await api.post(`/notification-push/channels/${id}/test`, { message: '这是一条测试消息' });
      if (res.data.success) {
        message.success('测试发送成功');
      } else {
        message.warning(`测试失败: ${res.data.detail || ''}`);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '测试失败');
    }
  };

  const openEditChannel = (ch: ChannelItem) => {
    setEditingChannelId(ch.id);
    setChannelType(ch.channel_type);
    const cfg = ch.config || {};
    const formValues: any = {
      channel_type: ch.channel_type,
      name: ch.name,
      enabled: ch.enabled,
    };
    if (ch.channel_type === 'wechat_bot' || ch.channel_type === 'dingtalk_bot') {
      formValues.webhook_url = cfg.webhook_url;
    } else if (ch.channel_type === 'email') {
      formValues.smtp_host = cfg.smtp_host;
      formValues.smtp_port = cfg.smtp_port;
      formValues.smtp_username = cfg.smtp_username;
      formValues.smtp_from_email = cfg.smtp_from_email;
      formValues.smtp_to_emails = cfg.smtp_to_emails;
      formValues.smtp_use_ssl = cfg.smtp_use_ssl ?? true;
    } else if (ch.channel_type === 'webhook') {
      formValues.webhook_url = cfg.url;
      formValues.webhook_secret = cfg.secret;
    }
    channelForm.setFieldsValue(formValues);
    setChannelModalOpen(true);
  };

  const channelColumns = [
    {
      title: '渠道名称', dataIndex: 'name', key: 'name', width: 160,
    },
    {
      title: '类型', dataIndex: 'channel_type', key: 'channel_type', width: 120,
      render: (v: string) => <Tag color={CHANNEL_TYPE_COLORS[v]}>{CHANNEL_TYPE_LABELS[v] || v}</Tag>,
    },
    {
      title: '状态', dataIndex: 'enabled', key: 'enabled', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180,
    },
    {
      title: '操作', key: 'action', width: 240,
      render: (_: unknown, record: ChannelItem) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditChannel(record)}>编辑</Button>
          <Button size="small" icon={<SendOutlined />} onClick={() => handleTestChannel(record.id)}>测试</Button>
          <Popconfirm title="确定删除此渠道？" onConfirm={() => handleDeleteChannel(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Subscriptions ──
  const fetchSubscriptions = async () => {
    setSubLoading(true);
    try {
      const res = await api.get('/notification-push/subscriptions');
      setEventTypes(res.data.event_types || []);
      setSubscriptions(res.data.subscriptions || {});
      // Also refresh channels for the matrix display
      const chRes = await api.get('/notification-push/channels');
      setChannels(chRes.data.items || []);
    } catch { /* ignore */ } finally {
      setSubLoading(false);
    }
  };

  const handleToggleSub = (channelId: number, eventType: string, checked: boolean) => {
    setSubscriptions(prev => {
      const current = prev[channelId] || [];
      const next = checked
        ? [...current, eventType]
        : current.filter(e => e !== eventType);
      return { ...prev, [channelId]: next };
    });
  };

  const handleSaveSubscriptions = async () => {
    setSubSaving(true);
    try {
      await api.put('/notification-push/subscriptions', { subscriptions });
      message.success('事件订阅已保存');
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '保存失败');
    } finally {
      setSubSaving(false);
    }
  };

  // ── Logs ──
  const fetchLogs = async () => {
    setLogLoading(true);
    try {
      const res = await api.get('/notification-push/logs?limit=100');
      setLogs(res.data.items || []);
    } catch { /* ignore */ } finally {
      setLogLoading(false);
    }
  };

  const logColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '渠道', dataIndex: 'channel_name', key: 'channel_name', width: 140 },
    {
      title: '类型', dataIndex: 'channel_type', key: 'channel_type', width: 100,
      render: (v: string) => <Tag color={CHANNEL_TYPE_COLORS[v]}>{CHANNEL_TYPE_LABELS[v] || v}</Tag>,
    },
    {
      title: '事件', dataIndex: 'event_type', key: 'event_type', width: 100,
      render: (v: string) => EVENT_LABELS[v] || v,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag>,
    },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message', width: 200, ellipsis: true },
    { title: '发送时间', dataIndex: 'sent_at', key: 'sent_at', width: 180 },
  ];

  useEffect(() => { fetchChannels(); }, []);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'subscriptions') fetchSubscriptions();
    if (key === 'logs') fetchLogs();
  };

  return (
    <Card title={t('menu.notificationPush')}>
      <Tabs activeKey={activeTab} onChange={handleTabChange} items={[
        {
          key: 'channels',
          label: '渠道管理',
          children: (
            <div>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingChannelId(null);
                    setChannelType('wechat_bot');
                    channelForm.resetFields();
                    setChannelModalOpen(true);
                  }}
                >
                  添加渠道
                </Button>
              </div>
              <Table
                dataSource={channels}
                columns={channelColumns}
                rowKey="id"
                loading={channelLoading}
                pagination={false}
                size="middle"
              />
            </div>
          ),
        },
        {
          key: 'subscriptions',
          label: '事件订阅',
          children: subLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : (
            <div>
              <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>
                勾选需要推送的事件，保存后生效。
              </div>
              <Table
                dataSource={channels}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  { title: '渠道', dataIndex: 'name', key: 'name', width: 160,
                    render: (v: string, r: ChannelItem) => (
                      <span>{v} <Tag color={CHANNEL_TYPE_COLORS[r.channel_type]} style={{ marginLeft: 4 }}>{CHANNEL_TYPE_LABELS[r.channel_type]}</Tag></span>
                    ),
                  },
                  ...eventTypes.map(evt => ({
                    title: EVENT_LABELS[evt] || evt,
                    key: evt,
                    width: 100,
                    align: 'center' as const,
                    render: (_: unknown, record: ChannelItem) => (
                      <Checkbox
                        checked={(subscriptions[record.id] || []).includes(evt)}
                        onChange={(e) => handleToggleSub(record.id, evt, e.target.checked)}
                      />
                    ),
                  })),
                ]}
              />
              <div style={{ marginTop: 16 }}>
                <Button type="primary" loading={subSaving} onClick={handleSaveSubscriptions}>
                  保存订阅配置
                </Button>
              </div>
            </div>
          ),
        },
        {
          key: 'logs',
          label: '推送记录',
          children: (
            <Table
              dataSource={logs}
              columns={logColumns}
              rowKey="id"
              loading={logLoading}
              pagination={{ pageSize: 20 }}
              size="small"
            />
          ),
        },
      ]} />

      {/* Channel modal */}
      <Modal
        title={editingChannelId ? '编辑渠道' : '添加渠道'}
        open={channelModalOpen}
        onOk={handleSaveChannel}
        onCancel={() => { setChannelModalOpen(false); channelForm.resetFields(); setEditingChannelId(null); }}
        destroyOnClose
        width={520}
      >
        <Form form={channelForm} layout="vertical" initialValues={{ channel_type: 'wechat_bot', enabled: true, smtp_port: 465, smtp_use_ssl: true }}>
          <Form.Item name="channel_type" label="渠道类型" rules={[{ required: true }]}>
            <Select
              options={CHANNEL_TYPE_OPTIONS}
              disabled={!!editingChannelId}
              onChange={(v) => setChannelType(v)}
            />
          </Form.Item>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：研发群企微机器人" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          {/* wechat_bot / dingtalk_bot */}
          {(channelType === 'wechat_bot' || channelType === 'dingtalk_bot') && (
            <Form.Item name="webhook_url" label="Webhook URL" rules={[{ required: true, message: '请输入 Webhook URL' }]}>
              <Input placeholder="https://..." />
            </Form.Item>
          )}

          {/* webhook */}
          {channelType === 'webhook' && (
            <>
              <Form.Item name="webhook_url" label="Webhook URL" rules={[{ required: true, message: '请输入 URL' }]}>
                <Input placeholder="https://..." />
              </Form.Item>
              <Form.Item name="webhook_secret" label="签名密钥（可选）">
                <Input placeholder="用于 HMAC-SHA256 签名验证" />
              </Form.Item>
            </>
          )}

          {/* email */}
          {channelType === 'email' && (
            <>
              <Form.Item name="smtp_host" label="SMTP 服务器" rules={[{ required: true, message: '请输入 SMTP 地址' }]}>
                <Input placeholder="smtp.example.com" />
              </Form.Item>
              <Form.Item name="smtp_port" label="端口">
                <Input type="number" placeholder="465" />
              </Form.Item>
              <Form.Item name="smtp_username" label="用户名">
                <Input placeholder="user@example.com" />
              </Form.Item>
              <Form.Item name="smtp_password" label="密码">
                <Input.Password placeholder="留空则不修改" />
              </Form.Item>
              <Form.Item name="smtp_from_email" label="发件人地址">
                <Input placeholder="noreply@example.com" />
              </Form.Item>
              <Form.Item name="smtp_to_emails" label="收件人（逗号分隔）" rules={[{ required: true, message: '请输入收件人' }]}>
                <Input placeholder="a@example.com, b@example.com" />
              </Form.Item>
              <Form.Item name="smtp_use_ssl" label="使用 SSL" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
