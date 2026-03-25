import { useState, useEffect } from 'react';
import { Card, Form, Input, InputNumber, Switch, Button, message, Divider, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

export default function NotifyPushConfig() {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    api.get('/api/notify-push/config').then(res => {
      if (res.data.config) form.setFieldsValue(res.data.config);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      await api.put('/api/notify-push/config', values);
      message.success(t('notifyPush.saveSuccess'));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (channel: string) => {
    setTestLoading(true);
    try {
      const res = await api.post('/api/notify-push/test', { channel, message: '这是一条测试消息 / This is a test message' });
      const results = res.data.results || [];
      const allOk = results.every((r: any) => r.success);
      if (allOk) message.success(t('notifyPush.testSuccess'));
      else message.warning(JSON.stringify(results));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('notifyPush.testFail'));
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Card title={t('notifyPush.title')}>
      <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
        <Divider orientation={'left' as any}>企业微信 / WeChat Work</Divider>
        <Form.Item name="wechat_work_webhook" label={t('notifyPush.wechatWebhook')}>
          <Input placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
        </Form.Item>

        <Divider orientation={'left' as any}>钉钉 / DingTalk</Divider>
        <Form.Item name="dingtalk_webhook" label={t('notifyPush.dingtalkWebhook')}>
          <Input placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
        </Form.Item>

        <Divider orientation={'left' as any}>邮件 / Email</Divider>
        <Form.Item name="smtp_host" label={t('notifyPush.smtpHost')}>
          <Input placeholder="smtp.example.com" />
        </Form.Item>
        <Form.Item name="smtp_port" label={t('notifyPush.smtpPort')}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="smtp_username" label={t('notifyPush.smtpUsername')}>
          <Input />
        </Form.Item>
        <Form.Item name="smtp_password" label={t('notifyPush.smtpPassword')}>
          <Input.Password placeholder="输入新密码以更新" />
        </Form.Item>
        <Form.Item name="smtp_from_email" label={t('notifyPush.smtpFromEmail')}>
          <Input />
        </Form.Item>
        <Form.Item name="smtp_to_emails" label={t('notifyPush.smtpToEmails')}>
          <Input placeholder="admin@example.com, ops@example.com" />
        </Form.Item>
        <Form.Item name="smtp_use_ssl" label={t('notifyPush.smtpUseSsl')} valuePropName="checked">
          <Switch />
        </Form.Item>

        <Divider orientation={'left' as any}>触发场景 / Trigger Events</Divider>
        <Form.Item name="notify_on_writeback" label={t('notifyPush.notifyOnWriteback')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="notify_on_approval" label={t('notifyPush.notifyOnApproval')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="notify_on_health_error" label={t('notifyPush.notifyOnHealthError')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="notify_on_task_fail" label={t('notifyPush.notifyOnTaskFail')} valuePropName="checked">
          <Switch />
        </Form.Item>

        <Space>
          <Button type="primary" onClick={handleSave} loading={loading}>保存 / Save</Button>
          <Button onClick={() => handleTest('all')} loading={testLoading}>{t('notifyPush.testNotification')}</Button>
        </Space>
      </Form>
    </Card>
  );
}
