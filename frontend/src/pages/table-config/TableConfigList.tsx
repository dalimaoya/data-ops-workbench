import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Space, Tag, Input, Select, message, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  listTableConfigs, countTableConfigs, deleteTableConfig, checkStructure,
  type TableConfig,
} from '../../api/tableConfig';
import { listDatasources, getDatasourceDatabases, type Datasource } from '../../api/datasource';
import { buildDatasourceOptions } from '../../utils/datasourceOptions';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';
import { findFirstHealthyDs } from '../../utils/datasourceHelper';
import { useTranslation } from 'react-i18next';

export default function TableConfigList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { onlineStatus } = useDatasourceOnline();
  const [data, setData] = useState<TableConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [filters, setFilters] = useState<{ datasource_id?: number; db_name?: string; keyword?: string }>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      const [listRes, countRes] = await Promise.all([
        listTableConfigs(params),
        countTableConfigs(params),
      ]);
      setData(listRes.data);
      setTotal(countRes.data.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    listDatasources({ page_size: 100 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : [];
      setDatasources(list);
      const healthy = findFirstHealthyDs(list, onlineStatus);
      if (healthy) setFilters(f => ({ ...f, datasource_id: healthy.id }));
    });
  }, []);

  // Fetch databases when datasource changes
  useEffect(() => {
    setDatabases([]);
    if (filters.datasource_id) {
      getDatasourceDatabases(filters.datasource_id)
        .then(res => setDatabases(res.data.databases || []))
        .catch(() => {});
    }
  }, [filters.datasource_id]);

  useEffect(() => { fetchData(); }, [page, pageSize, filters]);

  const handleCheckStructure = async (id: number) => {
    const res = await checkStructure(id);
    if (res.data.status === 'normal') {
      message.success(res.data.message);
    } else if (res.data.status === 'changed') {
      message.warning(res.data.message);
    } else {
      message.error(res.data.message);
    }
    fetchData();
  };

  const handleDelete = async (id: number) => {
    await deleteTableConfig(id);
    message.success(t('tableConfig.deleted'));
    fetchData();
  };

  const columns = [
    { title: t('common.datasource'), dataIndex: 'datasource_name', width: 140 },
    { title: t('tableConfig.dbSchema'), dataIndex: 'db_name', width: 120, render: (_: string, r: TableConfig) => r.db_name || r.schema_name || '-' },
    { title: t('common.tableName'), dataIndex: 'table_name', width: 160 },
    { title: t('tableConfig.tableAlias'), dataIndex: 'table_alias', width: 130 },
    { title: t('tableConfig.fieldCount'), dataIndex: 'field_count', width: 80 },
    { title: t('fieldConfig.primaryKey'), dataIndex: 'primary_key_fields', width: 120 },
    { title: t('tableConfig.configVersion'), dataIndex: 'config_version', width: 70 },
    {
      title: t('tableConfig.structureStatus'), dataIndex: 'structure_check_status', width: 100,
      render: (v: string) => {
        const map: Record<string, { color: string; textKey: string }> = {
          normal: { color: 'green', textKey: 'tableConfig.structureNormal' },
          changed: { color: 'red', textKey: 'tableConfig.structureChanged' },
          error: { color: 'orange', textKey: 'tableConfig.structureError' },
        };
        const info = map[v] || { color: 'default', textKey: '' };
        return <Tag color={info.color}>{info.textKey ? t(info.textKey) : (v || t('tableConfig.structureUnchecked'))}</Tag>;
      },
    },
    {
      title: t('datasource.onlineStatus'), width: 80,
      render: (_: unknown, r: TableConfig) => {
        const key = String(r.datasource_id);
        const checked = key in onlineStatus;
        if (!checked) return <Tag>{t('datasource.connectionNotTested')}</Tag>;
        return onlineStatus[key]
          ? <Tag color="success">{t('datasource.online')}</Tag>
          : <Tag color="error">{t('datasource.offline')}</Tag>;
      },
    },
    {
      title: t('common.operation'), width: 280, fixed: 'right' as const,
      render: (_: unknown, r: TableConfig) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => navigate(`/table-config/detail/${r.id}`)}>{t('tableConfig.configure')}</Button>
          <Button type="link" size="small" onClick={() => navigate(`/table-config/fields/${r.id}`)}>{t('tableConfig.fields')}</Button>
          <Button type="link" size="small" onClick={() => handleCheckStructure(r.id)}>{t('tableConfig.checkStructure')}</Button>
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" danger>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card title={t('tableConfig.title')} extra={
      <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/table-config/create')}>
        {t('tableConfig.createNew')}
      </Button>
    }>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear placeholder={t('common.datasource')} style={{ width: 220 }}
          value={filters.datasource_id}
          options={buildDatasourceOptions(datasources, onlineStatus)}
          onChange={v => setFilters(f => ({ ...f, datasource_id: v, db_name: undefined }))}
        />
        {filters.datasource_id && databases.length > 0 && (
          <Select
            allowClear showSearch placeholder={t('tableConfig.selectDatabase')} style={{ width: 180 }}
            value={filters.db_name}
            options={databases.map(d => ({ label: d, value: d }))}
            onChange={v => setFilters(f => ({ ...f, db_name: v }))}
          />
        )}
        <Input
          placeholder={t('tableConfig.searchTable')} prefix={<SearchOutlined />} style={{ width: 200 }}
          onPressEnter={e => setFilters(f => ({ ...f, keyword: (e.target as HTMLInputElement).value }))}
          allowClear onChange={e => { if (!e.target.value) setFilters(f => ({ ...f, keyword: undefined })); }}
        />
        <Button icon={<ReloadOutlined />} onClick={fetchData}>{t('common.refresh')}</Button>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        scroll={{ x: 1300 }}
        pagination={{
          current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </Card>
  );
}
