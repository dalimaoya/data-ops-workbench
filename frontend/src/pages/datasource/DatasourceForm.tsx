import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Form, Input, InputNumber, Select, Button, Card, Space, message, Switch,
} from 'antd';
import {
  getDatasource, createDatasource, updateDatasource, testConnection,
} from '../../api/datasource';
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
      const res = await testConnection({
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
      const payload = {
        datasource_name: vals.datasource_name,
        db_type: vals.db_type,
        host: vals.host,
        port: vals.port,
        database_name: vals.database_name || undefined,
        schema_name: vals.schema_name || undefined,
        username: vals.username,
        password: vals.password,
        charset: vals.charset || 'utf8',
        connect_timeout_seconds: vals.connect_timeout_seconds || 10,
        status: vals.status_switch ? 'enabled' : 'disabled',
        remark: vals.remark || undefined,
      };
      if (isEdit) {
        await updateDatasource(Number(id), payload);
        message.success(t('datasource.updateSuccess'));
      } else {
        await createDatasource(payload);
        message.success(t('datasource.createSuccess'));
      }
      navigate('/datasource');
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
          <Form.Item name="host" label={t('datasource.host')} rules={[{ required: true }]} style={{ flex: 1 }}>
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
