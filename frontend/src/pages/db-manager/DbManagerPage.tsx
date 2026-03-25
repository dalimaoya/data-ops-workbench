import { useState, useEffect, useCallback } from 'react';
import {
  Card, Select, Table, Button, Space, Tag, Modal, Form, Input,
  message, Typography, Tooltip, Popconfirm, Divider, Checkbox, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined,
  CopyOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

const { Text, Paragraph } = Typography;

interface Column {
  name: string;
  type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  default_value: string | null;
  comment?: string;
  extra?: string;
}

interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

interface DatasourceOption {
  id: number;
  datasource_name: string;
  db_type: string;
}

export default function DbManagerPage() {
  const { t } = useTranslation();
  const [datasources, setDatasources] = useState<DatasourceOption[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [tableComment, setTableComment] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Create table modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [newColumns, setNewColumns] = useState<Array<{
    name: string; type: string; is_primary_key: boolean; is_nullable: boolean;
    default_value: string; comment: string;
  }>>([{ name: '', type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, default_value: '', comment: '' }]);

  // SQL preview
  const [sqlPreview, setSqlPreview] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlExecutable, setSqlExecutable] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<any>) | null>(null);

  // Add column modal
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColForm] = Form.useForm();

  // Modify column modal
  const [modifyColOpen, setModifyColOpen] = useState(false);
  const [modifyColForm] = Form.useForm();
  const [modifyTarget, setModifyTarget] = useState<string>('');

  // Fetch datasources
  useEffect(() => {
    api.get('/datasource/list').then((res: any) => {
      const items = res.data?.items || res.data || [];
      setDatasources(items.map((d: any) => ({
        id: d.id,
        datasource_name: d.datasource_name,
        db_type: d.db_type,
      })));
    }).catch(() => {});
  }, []);

  // Fetch tables when datasource changes
  const fetchTables = useCallback(async () => {
    if (!selectedDs) return;
    setLoading(true);
    try {
      const res = await api.get('/db-manager/tables', { params: { datasource_id: selectedDs } });
      setTables(res.data?.tables || []);
    } catch {
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDs]);

  useEffect(() => {
    setSelectedTable(null);
    setColumns([]);
    setIndexes([]);
    if (selectedDs) fetchTables();
  }, [selectedDs, fetchTables]);

  // Fetch table structure
  const fetchStructure = useCallback(async () => {
    if (!selectedDs || !selectedTable) return;
    setLoading(true);
    try {
      const res = await api.get('/db-manager/table-structure', {
        params: { datasource_id: selectedDs, table_name: selectedTable },
      });
      setColumns(res.data?.columns || []);
      setIndexes(res.data?.indexes || []);
      setTableComment(res.data?.table_comment || '');
    } catch {
      setColumns([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDs, selectedTable]);

  useEffect(() => {
    if (selectedTable) fetchStructure();
  }, [selectedTable, fetchStructure]);

  // Preview SQL then optionally execute
  const showSql = (sql: string, canExecute: boolean, executeAction?: () => Promise<any>) => {
    setSqlPreview(sql);
    setSqlExecutable(canExecute);
    setPendingAction(canExecute && executeAction ? () => executeAction : null);
    setSqlOpen(true);
  };

  // Create table
  const handleCreateTable = async (execute: boolean) => {
    try {
      const values = await createForm.validateFields();
      const validCols = newColumns.filter(c => c.name.trim());
      if (validCols.length === 0) {
        message.warning('请至少添加一个字段');
        return;
      }
      const res = await api.post('/db-manager/create-table', {
        datasource_id: selectedDs,
        table_name: values.table_name,
        columns: validCols,
        comment: values.comment || null,
        execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || '建表成功');
        setCreateOpen(false);
        createForm.resetFields();
        setNewColumns([{ name: '', type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, default_value: '', comment: '' }]);
        fetchTables();
      } else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/create-table', {
            datasource_id: selectedDs,
            table_name: values.table_name,
            columns: validCols,
            comment: values.comment || null,
            execute: true,
          });
          if (execRes.data?.executed) {
            message.success(execRes.data.message || '建表成功');
            setCreateOpen(false);
            fetchTables();
          } else if (execRes.data?.error) {
            message.error(execRes.data.error);
          }
        });
      }
    } catch { /* validation error */ }
  };

  // Add column
  const handleAddColumn = async (execute: boolean) => {
    try {
      const values = await addColForm.validateFields();
      const res = await api.post('/db-manager/add-column', {
        datasource_id: selectedDs,
        table_name: selectedTable,
        column: {
          name: values.name,
          type: values.type,
          is_primary_key: false,
          is_nullable: values.is_nullable ?? true,
          default_value: values.default_value || null,
          comment: values.comment || null,
        },
        after_column: values.after_column || null,
        execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || '添加成功');
        setAddColOpen(false);
        addColForm.resetFields();
        fetchStructure();
      } else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/add-column', {
            ...res.data._req,
            datasource_id: selectedDs,
            table_name: selectedTable,
            column: { name: values.name, type: values.type, is_nullable: values.is_nullable ?? true, default_value: values.default_value || null, comment: values.comment || null },
            execute: true,
          });
          if (execRes.data?.executed) {
            message.success('添加成功');
            setAddColOpen(false);
            fetchStructure();
          }
        });
      }
    } catch { /* validation error */ }
  };

  // Drop column
  const handleDropColumn = async (colName: string) => {
    try {
      const res = await api.post('/db-manager/drop-column', {
        datasource_id: selectedDs,
        table_name: selectedTable,
        column_name: colName,
        execute: true,
      });
      if (res.data?.executed) {
        message.success(res.data.message || '字段已删除');
        fetchStructure();
      } else if (res.data?.error) {
        message.error(res.data.error);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    }
  };

  // Modify column
  const handleModifyColumn = async (execute: boolean) => {
    try {
      const values = await modifyColForm.validateFields();
      const res = await api.post('/db-manager/modify-column', {
        datasource_id: selectedDs,
        table_name: selectedTable,
        column_name: modifyTarget,
        new_type: values.new_type || null,
        new_name: values.new_name || null,
        new_comment: values.new_comment || null,
        execute,
      });
      if (execute && res.data?.executed) {
        message.success(res.data.message || '修改成功');
        setModifyColOpen(false);
        modifyColForm.resetFields();
        fetchStructure();
      } else {
        showSql(res.data?.sql || '', true, async () => {
          const execRes = await api.post('/db-manager/modify-column', {
            datasource_id: selectedDs,
            table_name: selectedTable,
            column_name: modifyTarget,
            new_type: values.new_type || null,
            new_name: values.new_name || null,
            new_comment: values.new_comment || null,
            execute: true,
          });
          if (execRes.data?.executed) {
            message.success('修改成功');
            setModifyColOpen(false);
            fetchStructure();
          }
        });
      }
    } catch { /* validation */ }
  };

  // Drop table
  const handleDropTable = async () => {
    if (!selectedTable || !selectedDs) return;
    try {
      const res = await api.post('/db-manager/drop-table', {
        datasource_id: selectedDs,
        table_name: selectedTable,
        confirm: true,
        backup_first: true,
      });
      if (res.data?.executed) {
        message.success(res.data.message || '表已删除');
        setSelectedTable(null);
        setColumns([]);
        fetchTables();
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    }
  };

  const addNewColumnRow = () => {
    setNewColumns([...newColumns, { name: '', type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, default_value: '', comment: '' }]);
  };

  const removeNewColumnRow = (index: number) => {
    setNewColumns(newColumns.filter((_, i) => i !== index));
  };

  const updateNewColumn = (index: number, field: string, value: any) => {
    const updated = [...newColumns];
    (updated[index] as any)[field] = value;
    setNewColumns(updated);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success('已复制'));
  };

  const structureColumns = [
    { title: t('dbManager.columnName'), dataIndex: 'name', key: 'name', width: 200 },
    { title: t('dbManager.columnType'), dataIndex: 'type', key: 'type', width: 180 },
    {
      title: t('dbManager.primaryKey'), dataIndex: 'is_primary_key', key: 'pk', width: 80,
      render: (v: boolean) => v ? <Tag color="blue">PK</Tag> : null,
    },
    {
      title: t('dbManager.nullable'), dataIndex: 'is_nullable', key: 'nullable', width: 80,
      render: (v: boolean) => v ? <Tag>YES</Tag> : <Tag color="red">NO</Tag>,
    },
    { title: t('dbManager.defaultValue'), dataIndex: 'default_value', key: 'default', width: 150 },
    { title: t('dbManager.comment'), dataIndex: 'comment', key: 'comment', width: 200 },
    {
      title: t('common.operation'), key: 'action', width: 140,
      render: (_: any, record: Column) => (
        <Space size="small">
          <Tooltip title={t('dbManager.modifyColumn')}>
            <Button
              type="link" size="small" icon={<EditOutlined />}
              onClick={() => {
                setModifyTarget(record.name);
                modifyColForm.setFieldsValue({ new_type: record.type, new_name: record.name, new_comment: record.comment || '' });
                setModifyColOpen(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title={`确认删除字段 ${record.name}？`}
            onConfirm={() => handleDropColumn(record.name)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title={t('dbManager.title')} style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder={t('dbManager.selectDatasource')}
            style={{ width: 260 }}
            value={selectedDs}
            onChange={v => setSelectedDs(v)}
            options={datasources.map(d => ({ value: d.id, label: `${d.datasource_name} (${d.db_type})` }))}
            showSearch
            filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
          />
          <Select
            placeholder={t('dbManager.selectTable')}
            style={{ width: 260 }}
            value={selectedTable}
            onChange={v => setSelectedTable(v)}
            options={tables.map(t => ({ value: t, label: t }))}
            showSearch
            disabled={!selectedDs}
            allowClear
          />
          <Button icon={<PlusOutlined />} type="primary" disabled={!selectedDs} onClick={() => setCreateOpen(true)}>
            {t('dbManager.createTable')}
          </Button>
          {selectedTable && (
            <Popconfirm
              title={t('dbManager.confirmDrop', { name: selectedTable })}
              onConfirm={handleDropTable}
              okType="danger"
            >
              <Button danger icon={<DeleteOutlined />}>{t('dbManager.dropTable')}</Button>
            </Popconfirm>
          )}
        </Space>

        {selectedTable && (
          <>
            <div style={{ marginBottom: 8 }}>
              <Space>
                <Text strong>{selectedTable}</Text>
                {tableComment && <Text type="secondary">— {tableComment}</Text>}
              </Space>
            </div>

            <Space style={{ marginBottom: 12 }}>
              <Button icon={<PlusOutlined />} onClick={() => { addColForm.resetFields(); setAddColOpen(true); }}>
                {t('dbManager.addColumn')}
              </Button>
            </Space>

            <Table
              columns={structureColumns}
              dataSource={columns}
              rowKey="name"
              loading={loading}
              size="small"
              pagination={false}
            />

            {indexes.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>{t('dbManager.indexes')}</Text>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={indexes}
                  rowKey="name"
                  columns={[
                    { title: '索引名', dataIndex: 'name', key: 'name' },
                    { title: '唯一', dataIndex: 'unique', key: 'unique', render: (v: boolean) => v ? <Tag color="green">UNIQUE</Tag> : <Tag>INDEX</Tag> },
                    { title: '字段', dataIndex: 'columns', key: 'columns', render: (v: string[]) => v.join(', ') },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {selectedDs && !selectedTable && tables.length === 0 && !loading && (
          <Empty description={t('dbManager.noTables')} />
        )}
      </Card>

      {/* Create Table Modal */}
      <Modal
        title={t('dbManager.createTable')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        width={900}
        footer={[
          <Button key="cancel" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleCreateTable(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleCreateTable(true)}>{t('dbManager.execute')}</Button>,
        ]}
      >
        <Form form={createForm} layout="vertical">
          <Space style={{ width: '100%' }}>
            <Form.Item name="table_name" label="表名" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="new_table" />
            </Form.Item>
            <Form.Item name="comment" label={t('dbManager.tableComment')} style={{ flex: 1 }}>
              <Input placeholder={t('dbManager.tableComment')} />
            </Form.Item>
          </Space>
        </Form>
        <Divider style={{ margin: '12px 0' }}>字段定义</Divider>
        {newColumns.map((col, i) => (
          <Space key={i} style={{ display: 'flex', marginBottom: 8, alignItems: 'center' }} wrap>
            <Input
              placeholder={t('dbManager.columnName')}
              value={col.name}
              onChange={e => updateNewColumn(i, 'name', e.target.value)}
              style={{ width: 140 }}
            />
            <Input
              placeholder={t('dbManager.columnType')}
              value={col.type}
              onChange={e => updateNewColumn(i, 'type', e.target.value)}
              style={{ width: 150 }}
            />
            <Checkbox
              checked={col.is_primary_key}
              onChange={e => updateNewColumn(i, 'is_primary_key', e.target.checked)}
            >PK</Checkbox>
            <Checkbox
              checked={col.is_nullable}
              onChange={e => updateNewColumn(i, 'is_nullable', e.target.checked)}
            >NULL</Checkbox>
            <Input
              placeholder={t('dbManager.defaultValue')}
              value={col.default_value}
              onChange={e => updateNewColumn(i, 'default_value', e.target.value)}
              style={{ width: 120 }}
            />
            <Input
              placeholder={t('dbManager.comment')}
              value={col.comment}
              onChange={e => updateNewColumn(i, 'comment', e.target.value)}
              style={{ width: 140 }}
            />
            <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeNewColumnRow(i)} disabled={newColumns.length <= 1} />
          </Space>
        ))}
        <Button type="dashed" icon={<PlusOutlined />} onClick={addNewColumnRow} style={{ width: '100%' }}>
          添加字段
        </Button>
      </Modal>

      {/* Add Column Modal */}
      <Modal
        title={t('dbManager.addColumn')}
        open={addColOpen}
        onCancel={() => setAddColOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAddColOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleAddColumn(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleAddColumn(true)}>{t('dbManager.execute')}</Button>,
        ]}
      >
        <Form form={addColForm} layout="vertical">
          <Form.Item name="name" label={t('dbManager.columnName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label={t('dbManager.columnType')} rules={[{ required: true }]}>
            <Input placeholder="VARCHAR(255)" />
          </Form.Item>
          <Form.Item name="is_nullable" valuePropName="checked" initialValue={true}>
            <Checkbox>{t('dbManager.nullable')}</Checkbox>
          </Form.Item>
          <Form.Item name="default_value" label={t('dbManager.defaultValue')}>
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('dbManager.comment')}>
            <Input />
          </Form.Item>
          <Form.Item name="after_column" label={t('dbManager.afterColumn')}>
            <Select
              allowClear
              placeholder="末尾"
              options={columns.map(c => ({ value: c.name, label: c.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modify Column Modal */}
      <Modal
        title={`${t('dbManager.modifyColumn')}: ${modifyTarget}`}
        open={modifyColOpen}
        onCancel={() => setModifyColOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setModifyColOpen(false)}>{t('common.cancel')}</Button>,
          <Button key="preview" icon={<EyeOutlined />} onClick={() => handleModifyColumn(false)}>{t('dbManager.sqlPreview')}</Button>,
          <Button key="execute" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleModifyColumn(true)}>{t('dbManager.execute')}</Button>,
        ]}
      >
        <Form form={modifyColForm} layout="vertical">
          <Form.Item name="new_name" label={t('dbManager.newColumnName')}>
            <Input />
          </Form.Item>
          <Form.Item name="new_type" label={t('dbManager.newColumnType')}>
            <Input />
          </Form.Item>
          <Form.Item name="new_comment" label={t('dbManager.comment')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* SQL Preview Modal */}
      <Modal
        title={t('dbManager.sqlPreview')}
        open={sqlOpen}
        onCancel={() => setSqlOpen(false)}
        width={700}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => copyToClipboard(sqlPreview)}>{t('common.download')}</Button>,
          <Button key="close" onClick={() => setSqlOpen(false)}>{t('common.close')}</Button>,
          ...(sqlExecutable && pendingAction ? [
            <Button key="exec" type="primary" icon={<PlayCircleOutlined />} onClick={async () => {
              if (pendingAction) {
                await pendingAction();
                setSqlOpen(false);
              }
            }}>{t('dbManager.execute')}</Button>,
          ] : []),
        ]}
      >
        <Paragraph>
          <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, maxHeight: 400, overflow: 'auto', fontSize: 13 }}>
            {sqlPreview}
          </pre>
        </Paragraph>
      </Modal>
    </div>
  );
}
