import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Select, Button, Input, Space, Table, message, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { listDatasources, type Datasource } from '../../api/datasource';
import { getRemoteTables, createTableConfig, type RemoteTableInfo } from '../../api/tableConfig';
import { useTranslation } from 'react-i18next';

export default function TableConfigCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | undefined>();
  const [remoteTables, setRemoteTables] = useState<RemoteTableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [selectedTable, setSelectedTable] = useState<RemoteTableInfo | undefined>();
  const [tableSearch, setTableSearch] = useState('');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listDatasources({ page_size: 100 }).then(r => setDatasources(r.data));
  }, []);

  const handleDsChange = async (dsId: number) => {
    setSelectedDs(dsId);
    setSelectedTable(undefined);
    setRemoteTables([]);
    setLoadingTables(true);
    try {
      const res = await getRemoteTables(dsId);
      setRemoteTables(res.data.tables);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('tableConfig.getTablesFailed'));
    } finally {
      setLoadingTables(false);
    }
  };

  const handleSelectTable = (tbl: RemoteTableInfo) => {
    setSelectedTable(tbl);
    form.setFieldsValue({
      table_name: tbl.table_name,
      table_alias: tbl.table_name,
      table_comment: tbl.table_comment || '',
    });
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    if (!selectedDs) { message.error(t('tableConfig.selectDatasource')); return; }
    setSaving(true);
    try {
      const res = await createTableConfig({
        datasource_id: selectedDs,
        table_name: values.table_name,
        table_alias: values.table_alias,
        table_comment: values.table_comment,
        primary_key_fields: values.primary_key_fields,
        remark: values.remark,
      });
      message.success(t('tableConfig.createSuccess'));
      navigate(`/table-config/detail/${res.data.id}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('common.failed'));
    } finally {
      setSaving(false);
    }
  };

  const tableColumns = [
    { title: t('common.tableName'), dataIndex: 'table_name' },
    { title: t('common.remark'), dataIndex: 'table_comment', render: (v: string) => v || '-' },
    {
      title: t('common.operation'),
      render: (_: unknown, r: RemoteTableInfo) => (
        <Button
          type={selectedTable?.table_name === r.table_name ? 'primary' : 'default'}
          size="small"
          onClick={() => handleSelectTable(r)}
        >
          {selectedTable?.table_name === r.table_name ? t('tableConfig.selected') : t('tableConfig.select')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Card title={t('tableConfig.createStep1')} style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            placeholder={t('tableConfig.selectDatasource')} style={{ width: 400 }}
            options={datasources.map(d => ({ label: `${d.datasource_name} (${d.db_type})`, value: d.id }))}
            onChange={handleDsChange}
          />
          {selectedDs && (
            <Spin spinning={loadingTables}>
              <Input
                placeholder={t('tableConfig.searchTable')}
                prefix={<SearchOutlined />}
                allowClear
                style={{ width: 300, marginTop: 16, marginBottom: 8 }}
                value={tableSearch}
                onChange={e => setTableSearch(e.target.value)}
              />
              <Table
                rowKey="table_name"
                columns={tableColumns}
                dataSource={remoteTables.filter(tbl =>
                  !tableSearch || tbl.table_name.toLowerCase().includes(tableSearch.toLowerCase())
                  || (tbl.table_comment && tbl.table_comment.toLowerCase().includes(tableSearch.toLowerCase()))
                )}
                size="small"
                pagination={{ pageSize: 10 }}
              />
            </Spin>
          )}
        </Space>
      </Card>

      {selectedTable && (
        <Card title={t('tableConfig.createStep2')}>
          <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
            <Form.Item name="table_name" label={t('common.tableName')} rules={[{ required: true }]}>
              <Input disabled />
            </Form.Item>
            <Form.Item name="table_alias" label={t('tableConfig.tableAlias')}>
              <Input placeholder={t('tableConfig.tableAliasPlaceholder')} />
            </Form.Item>
            <Form.Item name="table_comment" label={t('tableConfig.tableComment')}>
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="primary_key_fields" label={t('tableConfig.primaryKeyFields')} rules={[{ required: true, message: t('tableConfig.primaryKeyFieldsRequired') }]}
              tooltip={t('tableConfig.primaryKeyFieldsTip')}>
              <Input placeholder={t('tableConfig.primaryKeyFieldsPlaceholder')} />
            </Form.Item>
            <Form.Item name="remark" label={t('common.remark')}>
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" loading={saving} onClick={handleSave}>
                  {t('tableConfig.saveAndSync')}
                </Button>
                <Button onClick={() => navigate('/table-config')}>{t('common.cancel')}</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      )}
    </div>
  );
}
