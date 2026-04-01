import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Select, Button, Input, Space, Table, message, Spin, Tag, Descriptions } from 'antd';
import { SearchOutlined, KeyOutlined } from '@ant-design/icons';
import { listDatasources, getDatasourceDatabases, type Datasource } from '../../api/datasource';
import { buildDatasourceOptions } from '../../utils/datasourceOptions';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';
import { getRemoteTables, createTableConfig, type RemoteTableInfo } from '../../api/tableConfig';
import { findFirstHealthyDs } from '../../utils/datasourceHelper';
import { api } from '../../api/request';
import { useTranslation } from 'react-i18next';

interface RemoteColumn {
  column_name: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
}

export default function TableConfigCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { onlineStatus } = useDatasourceOnline();
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | undefined>();
  const [remoteTables, setRemoteTables] = useState<RemoteTableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [selectedTable, setSelectedTable] = useState<RemoteTableInfo | undefined>();
  const [tableSearch, setTableSearch] = useState('');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string | undefined>();
  const [loadingDbs, setLoadingDbs] = useState(false);

  // Preview: columns + sample data
  const [previewColumns, setPreviewColumns] = useState<RemoteColumn[]>([]);
  const [sampleColumns, setSampleColumns] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<(string | null)[][]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    listDatasources({ page_size: 100 }).then(r => {
      const list = r.data || [];
      setDatasources(list);
      // 默认选中第1个连接正常的数据源
      if (list.length > 0 && !selectedDs) {
        const healthy = findFirstHealthyDs(list, onlineStatus);
        if (healthy) handleDsChange(healthy.id);
      }
    });
  }, []);

  const handleDsChange = async (dsId: number) => {
    setSelectedDs(dsId);
    setSelectedDb(undefined);
    setSelectedTable(undefined);
    setRemoteTables([]);
    setPreviewColumns([]);
    setSampleRows([]);
    setDatabases([]);

    // Fetch available databases
    setLoadingDbs(true);
    try {
      const dbRes = await getDatasourceDatabases(dsId);
      setDatabases(dbRes.data.databases || []);
    } catch {
      // Ignore — some db types may not support listing databases
    } finally {
      setLoadingDbs(false);
    }

    // Also fetch tables using datasource default database
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

  const handleDbChange = async (dbName: string | undefined) => {
    setSelectedDb(dbName);
    setSelectedTable(undefined);
    setRemoteTables([]);
    setPreviewColumns([]);
    setSampleRows([]);
    if (!selectedDs) return;
    setLoadingTables(true);
    try {
      const res = await getRemoteTables(selectedDs, dbName ? { db_name: dbName } : undefined);
      setRemoteTables(res.data.tables);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('tableConfig.getTablesFailed'));
    } finally {
      setLoadingTables(false);
    }
  };

  const handleSelectTable = async (tbl: RemoteTableInfo) => {
    setSelectedTable(tbl);
    form.setFieldsValue({
      table_name: tbl.table_name,
      table_alias: tbl.table_comment || '',  // Use DB comment as alias hint, let backend AI suggest if empty
      table_comment: tbl.table_comment || '',
      primary_key_fields: undefined,
    });

    // Fetch preview data
    if (selectedDs) {
      setLoadingPreview(true);
      try {
        const res = await api.get(`/table-config/remote-preview/${selectedDs}`, {
          params: { table_name: tbl.table_name, sample_limit: 5, ...(selectedDb ? { db_name: selectedDb } : {}) },
        });
        const cols: RemoteColumn[] = res.data.columns || [];
        setPreviewColumns(cols);
        setSampleColumns(res.data.sample_columns || []);
        setSampleRows(res.data.sample_rows || []);

        // Auto-set primary key from detected PK columns
        const pkFields = cols.filter(c => c.is_primary_key).map(c => c.column_name);
        if (pkFields.length > 0) {
          form.setFieldsValue({ primary_key_fields: pkFields });
        }
      } catch {
        setPreviewColumns([]);
        setSampleRows([]);
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    if (!selectedDs) { message.error(t('tableConfig.selectDatasource')); return; }
    setSaving(true);
    try {
      const pkValue = Array.isArray(values.primary_key_fields)
        ? values.primary_key_fields.join(',')
        : values.primary_key_fields;
      const res = await createTableConfig({
        datasource_id: selectedDs,
        db_name: selectedDb || undefined,
        table_name: values.table_name,
        table_alias: values.table_alias,
        table_comment: values.table_comment,
        primary_key_fields: pkValue,
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

  // Field preview columns
  const fieldPreviewColumns = [
    {
      title: t('fieldConfig.fieldName', '字段名'),
      dataIndex: 'column_name',
      key: 'column_name',
      width: 200,
      render: (val: string, record: RemoteColumn) => (
        <Space>
          <span style={{ fontWeight: record.is_primary_key ? 600 : 400 }}>{val}</span>
          {record.is_primary_key && <Tag color="gold"><KeyOutlined /> PK</Tag>}
        </Space>
      ),
    },
    {
      title: t('fieldConfig.dbType', '数据类型'),
      dataIndex: 'data_type',
      key: 'data_type',
      width: 160,
    },
    {
      title: t('fieldConfig.nullable', '可空'),
      dataIndex: 'is_nullable',
      key: 'is_nullable',
      width: 80,
      render: (val: boolean) => val ? <Tag>YES</Tag> : <Tag color="red">NO</Tag>,
    },
  ];

  // Sample data table columns
  const sampleTableColumns = sampleColumns.map(col => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
    width: 140,
  }));
  const sampleTableData = sampleRows.map((row, idx) => {
    const obj: Record<string, unknown> = { _key: idx };
    sampleColumns.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });

  // Primary key options from preview columns
  const pkOptions = previewColumns.map(c => ({
    label: `${c.column_name} (${c.data_type})`,
    value: c.column_name,
  }));

  return (
    <div>
      <Card title={t('tableConfig.createStep1')} style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Select
              placeholder={t('tableConfig.selectDatasource')} style={{ width: 400 }}
              value={selectedDs}
              options={buildDatasourceOptions(datasources, onlineStatus)}
              onChange={handleDsChange}
            />
            {selectedDs && databases.length > 0 && (
              <Select
                placeholder={t('tableConfig.selectDatabase')}
                style={{ width: 240 }}
                allowClear
                loading={loadingDbs}
                value={selectedDb}
                onChange={handleDbChange}
                showSearch
                options={databases.map(d => ({ label: d, value: d }))}
              />
            )}
          </Space>
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
                pagination={{
                  defaultPageSize: 20,
                  pageSizeOptions: ['10', '20', '50', '100'],
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 张表`,
                }}
              />
            </Spin>
          )}
        </Space>

        {/* Field Preview + Sample Data */}
        {selectedTable && (
          <Spin spinning={loadingPreview}>
            {previewColumns.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
                  <Descriptions.Item label={t('common.tableName')}>{selectedTable.table_name}</Descriptions.Item>
                  <Descriptions.Item label={t('dbMaintenance.fieldCount', '字段数')}>{previewColumns.length}</Descriptions.Item>
                  <Descriptions.Item label="PK">
                    {previewColumns.filter(c => c.is_primary_key).map(c => c.column_name).join(', ') || '-'}
                  </Descriptions.Item>
                </Descriptions>

                <Card title={t('fieldConfig.fieldList', '字段列表')} size="small" style={{ marginBottom: 12 }}>
                  <Table
                    rowKey="column_name"
                    columns={fieldPreviewColumns}
                    dataSource={previewColumns}
                    size="small"
                    pagination={false}
                  />
                </Card>

                {sampleTableData.length > 0 && (
                  <Card title={t('tableDetail.sampleData', '示例数据（前5行）')} size="small">
                    <Table
                      rowKey="_key"
                      columns={sampleTableColumns}
                      dataSource={sampleTableData}
                      size="small"
                      pagination={false}
                      scroll={{ x: sampleTableColumns.length * 140 }}
                    />
                  </Card>
                )}
              </div>
            )}
          </Spin>
        )}
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
              {pkOptions.length > 0 ? (
                <Select
                  mode="multiple"
                  placeholder={t('tableConfig.primaryKeyFieldsPlaceholder')}
                  options={pkOptions}
                />
              ) : (
                <Input placeholder={t('tableConfig.primaryKeyFieldsPlaceholder')} />
              )}
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
