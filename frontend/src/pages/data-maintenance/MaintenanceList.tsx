import { useState, useEffect } from 'react';
import { Table, Card, Input, Button, Tag, Space, Select, message } from 'antd';
import { SearchOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { listMaintenanceTables, batchExportTables } from '../../api/dataMaintenance';
import type { MaintenanceTable } from '../../api/dataMaintenance';
import { listDatasources, getDatasourceDatabases } from '../../api/datasource';
import { buildDatasourceOptions } from '../../utils/datasourceOptions';
import { useDatasourceOnline } from '../../context/DatasourceOnlineContext';
import type { Datasource } from '../../api/datasource';
import { formatBeijingTime } from '../../utils/formatTime';
import { useTranslation } from 'react-i18next';
import { findFirstHealthyDs } from '../../utils/datasourceHelper';

export default function MaintenanceList() {
  const { t } = useTranslation();
  const { onlineStatus } = useDatasourceOnline();
  const [data, setData] = useState<MaintenanceTable[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [datasourceId, setDatasourceId] = useState<number | undefined>(undefined);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchExporting, setBatchExporting] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [dbName, setDbName] = useState<string | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    listDatasources({ page_size: 100 }).then(r => {
      const list = r.data || [];
      setDatasources(list);
      // 默认选中第1个连接正常的数据源
      if (list.length > 0 && !datasourceId) {
        const healthy = findFirstHealthyDs(list, onlineStatus);
        if (healthy) setDatasourceId(healthy.id);
      }
    }).catch(() => {});
  }, []);

  // Fetch databases when datasource changes
  useEffect(() => {
    setDatabases([]);
    setDbName(undefined);
    if (datasourceId) {
      getDatasourceDatabases(datasourceId)
        .then(res => setDatabases(res.data.databases || []))
        .catch(() => {});
    }
  }, [datasourceId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listMaintenanceTables({
        keyword: keyword || undefined,
        datasource_id: datasourceId,
        db_name: dbName || undefined,
        page,
        page_size: pageSize,
      });
      setData(res.data.items);
      setTotal(res.data.total);
    } catch {
      message.error(t('maintenance.getListFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page, pageSize, datasourceId, dbName]);

  const handleSearch = () => { setPage(1); fetchData(); };

  const handleReset = () => {
    setKeyword('');
    setDatasourceId(undefined);
    setDbName(undefined);
    setPage(1);
    setTimeout(() => fetchData(), 0);
  };

  const handleBatchExport = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('maintenance.batchExportEmpty'));
      return;
    }
    setBatchExporting(true);
    try {
      const res = await batchExportTables(selectedRowKeys);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers?.['content-disposition'];
      let filename = 'batch_export.zip';
      if (disposition) {
        const m = disposition.match(/filename\*?=(?:UTF-8'')?([^;\n]+)/i);
        if (m) filename = decodeURIComponent(m[1].replace(/"/g, ''));
      }
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success(t('maintenance.batchExportSuccess', { count: selectedRowKeys.length }));
      setSelectedRowKeys([]);
    } catch {
      message.error(t('maintenance.batchExportFailed'));
    } finally {
      setBatchExporting(false);
    }
  };

  const columns = [
    {
      title: t('maintenance.tableAlias'),
      dataIndex: 'table_alias',
      key: 'table_alias',
      width: 140,
      ellipsis: true,
      render: (v: string, r: MaintenanceTable) => v || r.table_name,
    },
    { title: t('common.datasource'), dataIndex: 'datasource_name', key: 'datasource_name', width: 140, ellipsis: true },
    { title: t('maintenance.dbSchema'), dataIndex: 'db_name', key: 'db_name', width: 120, ellipsis: true, render: (v: string, r: MaintenanceTable) => v || r.schema_name || '-' },
    { title: t('common.tableName'), dataIndex: 'table_name', key: 'table_name', width: 180, ellipsis: true },
    { title: t('maintenance.fieldCount'), dataIndex: 'field_count', key: 'field_count', width: 80 },
    { title: t('maintenance.configVersion'), dataIndex: 'config_version', key: 'config_version', width: 90, render: (v: number) => `v${v}` },
    {
      title: t('maintenance.structureStatus'),
      dataIndex: 'structure_check_status',
      key: 'structure_check_status',
      width: 110,
      render: (v: string) => {
        const map: Record<string, { color: string; text: string }> = {
          normal: { color: 'green', text: t('maintenance.structureNormal') },
          changed: { color: 'red', text: t('maintenance.structureChanged') },
          error: { color: 'orange', text: t('maintenance.structureError') },
        };
        const s = map[v] || { color: 'default', text: v || '-' };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    { title: t('maintenance.updatedBy'), dataIndex: 'updated_by', key: 'updated_by', width: 80 },
    { title: t('maintenance.updatedAt'), dataIndex: 'updated_at', key: 'updated_at', width: 180, render: (v: string) => formatBeijingTime(v) },
    {
      title: t('common.operation'),
      key: 'action',
      width: 120,
      render: (_: unknown, r: MaintenanceTable) => (
        <Button type="link" onClick={() => navigate(`/data-maintenance/browse/${r.id}`)}>
          {t('maintenance.enterMaintenance')}
        </Button>
      ),
    },
  ];

  return (
    <Card title={t('maintenance.title')}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder={t('maintenance.selectDatasource')}
          allowClear
          value={datasourceId}
          onChange={(v) => { setDatasourceId(v); setDbName(undefined); setDatabases([]); }}
          style={{ width: 200 }}
          options={buildDatasourceOptions(datasources, onlineStatus)}
        />
        {datasourceId && databases.length > 0 && (
          <Select
            placeholder={t('tableConfig.selectDatabase')}
            allowClear
            showSearch
            value={dbName}
            onChange={setDbName}
            style={{ width: 180 }}
            options={databases.map(d => ({ label: d, value: d }))}
          />
        )}
        <Input
          placeholder={t('maintenance.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 260 }}
          allowClear
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
          {t('common.search')}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={handleReset}>
          {t('common.reset')}
        </Button>
        {selectedRowKeys.length > 0 && (
          <Button
            icon={<DownloadOutlined />}
            type="primary"
            loading={batchExporting}
            onClick={handleBatchExport}
          >
            {t('maintenance.batchExport', { count: selectedRowKeys.length })}
          </Button>
        )}
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showTotal: (t_count) => t('common.total', { count: t_count }),
        }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
}
