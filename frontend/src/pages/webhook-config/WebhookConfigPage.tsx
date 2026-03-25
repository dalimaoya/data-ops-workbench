import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Switch, Space, Tag, message, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

const EVENT_OPTIONS = ['writeback', 'export', 'import', 'approval', 'user_change'];

export default function WebhookConfigPage() {
  const { t } = useTranslation();
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form] = Form.useForm();

  const fetchWebhooks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/webhooks');
      setWebhooks(res.data.items || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWebhooks(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editId) {
        await api.put(`/api/webhooks/${editId}`, values);
      } else {
        await api.post('/webhooks', values);
      }
      message.success('保存成功');
      setModalOpen(false);
      form.resetFields();
      setEditId(null);
      fetchWebhooks();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/webhooks/${id}`);
      message.success('已删除');
      fetchWebhooks();
    } catch { message.error('删除失败'); }
  };

  const handleTest = async (id: number) => {
    try {
      const res = await api.post(`/api/webhooks/${id}/test`);
      if (res.data.success) message.success(t('webhook.testSuccess'));
      else message.warning(`${t('webhook.testFail')}: ${res.data.error || res.data.response || ''}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('webhook.testFail'));
    }
  };

  const handleEdit = async (id: number) => {
    try {
      const res = await api.get(`/api/webhooks/${id}`);
      form.setFieldsValue(res.data);
      setEditId(id);
      setModalOpen(true);
    } catch { message.error('加载失败'); }
  };

  const eventLabels: Record<string, string> = {
    writeback: t('webhook.eventWriteback'),
    export: t('webhook.eventExport'),
    import: t('webhook.eventImport'),
    approval: t('webhook.eventApproval'),
    user_change: t('webhook.eventUserChange'),
  };

  const columns = [
    { title: t('webhook.name'), dataIndex: 'name', key: 'name' },
    { title: t('webhook.url'), dataIndex: 'url', key: 'url', ellipsis: true },
    { title: t('webhook.events'), dataIndex: 'events', key: 'events',
      render: (evts: string[]) => evts?.map(e => <Tag key={e}>{eventLabels[e] || e}</Tag>) },
    { title: t('webhook.enabled'), dataIndex: 'enabled', key: 'enabled',
      render: (v: boolean) => v ? <Tag color="green">✓</Tag> : <Tag>✗</Tag> },
    { title: t('webhook.lastTriggered'), dataIndex: 'last_triggered_at', key: 'last_triggered_at',
      render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '操作', key: 'actions', render: (_: any, record: any) => (
      <Space>
        <Button type="link" size="small" onClick={() => handleEdit(record.id)}>编辑</Button>
        <Button type="link" size="small" onClick={() => handleTest(record.id)} icon={<SendOutlined />}>{t('webhook.test')}</Button>
        <Popconfirm title={t('webhook.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title={t('webhook.title')} extra={
      <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setEditId(null); setModalOpen(true); }}>
        {t('webhook.addWebhook')}
      </Button>
    }>
      <Table columns={columns} dataSource={webhooks} rowKey="id" loading={loading} size="small" />

      <Modal title={editId ? '编辑 Webhook' : t('webhook.addWebhook')} open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditId(null); form.resetFields(); }}
        onOk={handleSave}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('webhook.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label={t('webhook.url')} rules={[{ required: true }]}>
            <Input placeholder="https://example.com/webhook" />
          </Form.Item>
          <Form.Item name="secret" label="Secret">
            <Input.Password placeholder="可选签名密钥" />
          </Form.Item>
          <Form.Item name="events" label={t('webhook.events')}>
            <Select mode="multiple" placeholder="选择触发事件">
              {EVENT_OPTIONS.map(e => <Select.Option key={e} value={e}>{eventLabels[e] || e}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="enabled" label={t('webhook.enabled')} valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
