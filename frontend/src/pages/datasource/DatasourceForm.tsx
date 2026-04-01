import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Form, Input, InputNumber, Select, Button, Card, Space, message, Switch, Modal,
} from 'antd';
import {
  getDatasource, createDatasource, updateDatasource, testConnection, testExistingDatasource,
} from '../../api/datasource';
import { api } from '../../api/request';
import { useTranslation } from 'react-i18next';

const dbTypeKeys: { key: string; value: string }[] = [
  { key: 'dbTypeMySQL', value: 'mysql' },
  { key: 'dbTypePostgreSQL', value: 'postgresql' },
  { key: 'dbTypeSQLServer', value: 'sqlserver' },
  { key: 'dbTypeOracle', value: 'oracle' },
  { key: 'dbTypeDM', value: 'dm' },
  { key: 'dbTypeKingbase', value: 'kingbase' },
  { key: 'dbTypeSQLite', value: 'sqlite' },
];

const defaultPorts: Record<string, number> = {
  mysql: 3306, postgresql: 5432, sqlserver: 1433,
  oracle: 1521, dm: 5236, kingbase: 54321, sqlite: 0,
};

export default function DatasourceForm() {
  const { t } = useTranslation();
  const dbTypeOptions = dbTypeKeys.map(d => ({ label: t(`datasource.${d.key}`), value: d.value }));
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (isEdit) {
      getDatasource(Number(id)).then(res => {
        const d = res.data;
        form.setFieldsValue({
          ...d,
          password: '',
          status_switch: d.status === 'enabled',
        });
      });
    }
  }, [id]);

  const handleDbTypeChange = (val: string) => {
    form.setFieldValue('port', defaultPorts[val] || 3306);
  };

  const handleTest = async () => {
    try {
      const vals = await form.validateFields();
      setTesting(true);
      let res;
      if (isEdit && !vals.password) {
        // Password empty on edit → use saved password via existing datasource test
        res = await testExistingDatasource(Number(id));
      } else {
        res = await testConnection({
          db_type: vals.db_type,
          host: vals.host,
          port: vals.port,
          database_name: vals.database_name,
          schema_name: vals.schema_name,
          username: vals.username,
          password: vals.password,
          charset: vals.charset,
          connect_timeout_seconds: vals.connect_timeout_seconds,
        });
      }
      if (res.data.success) {
        message.success(res.data.message);
      } else {
        message.error(res.data.message);
      }
    } catch {
      message.warning(t('datasource.fillFormFirst'));
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      const payload: any = {
        datasource_name: vals.datasource_name,
        db_type: vals.db_type,
        host: vals.host,
        port: vals.port,
        database_name: vals.database_name || null,
        schema_name: vals.schema_name || null,
        username: vals.username,
        charset: vals.charset || 'utf8',
        connect_timeout_seconds: vals.connect_timeout_seconds || 10,
        status: vals.status_switch ? 'enabled' : 'disabled',
        remark: vals.remark || null,
      };
      // Only include password if it's not empty (on edit, empty means "keep unchanged")
      if (vals.password) {
        payload.password = vals.password;
      } else if (!isEdit) {
        payload.password = vals.password;
      }
      if (isEdit) {
        await updateDatasource(Number(id), payload);
        message.success(t('datasource.updateSuccess'));
        navigate('/datasource');
      } else {
        // Check for restorable deleted datasource with same connection
        try {
          const checkRes = await api.post<{ found: boolean; datasource_id?: number; datasource_name?: string; managed_count?: number }>('/datasource/check-restore', {
            db_type: vals.db_type, host: vals.host, port: vals.port,
            database_name: vals.database_name || null,
            username: vals.username, password: vals.password || '',
          });
          if (checkRes.data.found && checkRes.data.datasource_id) {
            const { datasource_id, datasource_name, managed_count } = checkRes.data;
            Modal.confirm({
              title: t('datasource.restoreFoundTitle'),
              content: t('datasource.restoreFoundContent', { name: datasource_name, count: managed_count || 0 }),
              okText: t('datasource.restoreAction'),
              cancelText: t('datasource.createNewAnyway'),
              onOk: async () => {
                await api.post(`/datasource/${datasource_id}/restore`);
                message.success(t('datasource.restoreSuccess'));
                navigate('/datasource');
              },
              onCancel: async () => {
                await createDatasource(payload);
                message.success(t('datasource.createSuccess'));
                navigate('/datasource');
              },
            });
            return;
          }
        } catch { /* ignore, proceed with create */ }
        await createDatasource(payload);
        message.success(t('datasource.createSuccess'));
        navigate('/datasource');
      }
    } catch {
      // validation error
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title={isEdit ? t('datasource.editTitle') : t('datasource.createTitle')}>
      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 600 }}
        initialValues={{ port: 3306, charset: 'utf8', connect_timeout_seconds: 10, status_switch: true }}
      >
        <Form.Item name="datasource_name" label={t('datasource.name')} rules={[{ required: true, message: t('datasource.nameRequired') }]}>
          <Input placeholder={t('datasource.namePlaceholder')} />
        </Form.Item>

        <Form.Item name="db_type" label={t('datasource.dbType')} rules={[{ required: true, message: t('datasource.dbTypeRequired') }]}>
          <Select options={dbTypeOptions} placeholder={t('datasource.dbTypePlaceholder')} onChange={handleDbTypeChange} />
        </Form.Item>

        <Space style={{ width: '100%' }}>
          <Form.Item
            name="host"
            label={t('datasource.host')}
            normalize={(v: string) => v?.trim()}
            rules={[
              { required: true },
              {
                pattern: /^[a-zA-Z0-9]([a-zA-Z0-9\-_.]*[a-zA-Z0-9])?$/,
                message: t('datasource.hostFormatError'),
              },
            ]}
            style={{ flex: 1 }}
          >
            <Input placeholder="127.0.0.1" />
          </Form.Item>
          <Form.Item name="port" label={t('datasource.port')} rules={[{ required: true }]} style={{ width: 120 }}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
        </Space>

        <Form.Item name="database_name" label={t('datasource.databaseName')}>
          <Input placeholder={t('datasource.databaseNamePlaceholder')} />
        </Form.Item>

        <Form.Item name="schema_name" label={t('datasource.schemaName')}>
          <Input placeholder={t('datasource.schemaNamePlaceholder')} />
        </Form.Item>

        <Space style={{ width: '100%' }}>
          <Form.Item name="username" label={t('datasource.username')} rules={[{ required: true }]} style={{ flex: 1 }}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t('datasource.passwordLabel')} rules={[{ required: !isEdit, message: t('datasource.passwordRequired') }]} style={{ flex: 1 }}>
            <Input.Password placeholder={isEdit ? t('datasource.passwordEditHint') : ''} />
          </Form.Item>
        </Space>

        <Space style={{ width: '100%' }}>
          <Form.Item name="charset" label={t('datasource.charset')}>
            <Input style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="connect_timeout_seconds" label={t('datasource.timeout')}>
            <InputNumber min={1} max={300} style={{ width: 120 }} />
          </Form.Item>
        </Space>

        <Form.Item name="status_switch" label={t('datasource.enableStatus')} valuePropName="checked">
          <Switch checkedChildren={t('common.enabled')} unCheckedChildren={t('common.disabled')} />
        </Form.Item>

        <Form.Item name="remark" label={t('common.remark')}>
          <Input.TextArea rows={3} />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" loading={loading} onClick={handleSubmit}>
              {isEdit ? t('datasource.saveChanges') : t('common.create')}
            </Button>
            <Button loading={testing} onClick={handleTest}>{t('datasource.testConnection')}</Button>
            <Button onClick={() => navigate('/datasource')}>{t('common.cancel')}</Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
