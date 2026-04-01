import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Tag, Input, Select, message, Modal, Card,
} from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  listDatasources, countDatasources, deleteDatasource,
  testExistingDatasource,
} from '../../api/datasource';

import type { Datasource } from '../../api/datasource';
import { useTranslation } from 'react-i18next';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';

export default function DatasourceList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { onlineStatus } = useDatasourceOnline();
  const [data, setData] = useState<Datasource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [dbType, setDbType] = useState('');
  const [status, setStatus] = useState('');

  const dbTypeOptions = [
    { label: t('common.all'), value: '' },
    { label: t('datasource.dbTypeMySQL'), value: 'mysql' },
    { label: t('datasource.dbTypePostgreSQL'), value: 'postgresql' },
    { label: t('datasource.dbTypeSQLServer'), value: 'sqlserver' },
    { label: t('datasource.dbTypeOracle'), value: 'oracle' },
    { label: t('datasource.dbTypeDM'), value: 'dm' },
    { label: t('datasource.dbTypeKingbase'), value: 'kingbase' },
    { label: t('datasource.dbTypeSQLite'), value: 'sqlite' },
  ];

  const statusOptions = [
    { label: t('common.all'), value: '' },
    { label: t('common.enabled'), value: 'enabled' },
    { label: t('common.disabled'), value: 'disabled' },
  ];

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (keyword) params.keyword = keyword;
      if (dbType) params.db_type = dbType;
      if (status) params.status = status;
      const [listRes, countRes] = await Promise.all([
        listDatasources(params),
        countDatasources(params),
      ]);
      setData(listRes.data);
      setTotal(countRes.data.total);
    } catch {
      message.error(t('datasource.listFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page, pageSize]);

  const handleSearch = () => { setPage(1); fetchData(); };

  const handleDelete = async (record: Datasource) => {
    Modal.confirm({
      title: t('datasource.deleteConfirmTitle'),
      icon: <ExclamationCircleOutlined />,
      content: t('datasource.deleteCascadeConfirm', { name: record.datasource_name }),
      okText: t('common.confirm'),
      okType: 'danger',
      onOk: async () => {
        await deleteDatasource(record.id, true);
        message.success(t('datasource.deleteSuccess'));
        fetchData();
      },
    });
  };

  const handleTest = async (id: number) => {
    const hide = message.loading(t('datasource.testing'), 0);
    try {
      const res = await testExistingDatasource(id);
      if (res.data.success) {
        message.success(res.data.message);
      } else {
        message.error(res.data.message);
      }
      fetchData();
    } catch {
      message.error(t('datasource.testFailed'));
    } finally {
      hide();
    }
  };

  const columns: ColumnsType<Datasource> = [
    { title: t('datasource.name'), dataIndex: 'datasource_name', width: 160 },
    {
      title: t('datasource.dbType'), dataIndex: 'db_type', width: 120,
      render: (v: string) => <Tag color={v === 'mysql' ? 'blue' : v === 'postgresql' ? 'green' : 'orange'}>{v.toUpperCase()}</Tag>,
    },
    { title: t('datasource.host'), dataIndex: 'host', width: 160 },
    { title: t('datasource.port'), dataIndex: 'port', width: 80 },
    { title: t('datasource.databaseName'), dataIndex: 'database_name', width: 120 },
    {
      title: t('datasource.onlineStatus'), width: 90,
      render: (_: unknown, record: Datasource) => {
        const key = String(record.id);
        const checked = key in onlineStatus;
        if (!checked) return <Tag>{t('datasource.connectionNotTested')}</Tag>;
        return onlineStatus[key]
          ? <Tag color="success">{t('datasource.online')}</Tag>
          : <Tag color="error">{t('datasource.offline')}</Tag>;
      },
    },
    {
      title: t('common.status'), dataIndex: 'status', width: 90,
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'default'}>{v === 'enabled' ? t('common.enabled') : t('common.disabled')}</Tag>,
    },
    { title: t('common.remark'), dataIndex: 'remark', width: 150, ellipsis: true },
    {
      title: t('common.operation'), width: 240, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/datasource/edit/${record.id}`)}>{t('common.edit')}</Button>
          <Button size="small" onClick={() => handleTest(record.id)}>{t('common.test')}</Button>
          <Button size="small" danger onClick={() => handleDelete(record)}>{t('common.delete')}</Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('datasource.title')}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/datasource/create')}>{t('datasource.createNew')}</Button>}
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          placeholder={t('datasource.searchPlaceholder')}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 200 }}
          prefix={<SearchOutlined />}
        />
        <Select options={dbTypeOptions} value={dbType} onChange={setDbType} style={{ width: 140 }} placeholder={t('datasource.dbType')} />
        <Select options={statusOptions} value={status} onChange={setStatus} style={{ width: 120 }} placeholder={t('common.status')} />
        <Button icon={<SearchOutlined />} type="primary" onClick={handleSearch}>{t('common.search')}</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { setKeyword(''); setDbType(''); setStatus(''); setPage(1); setTimeout(fetchData, 0); }}>{t('common.reset')}</Button>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: t_count => t('common.total', { count: t_count }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </Card>
  );
}
