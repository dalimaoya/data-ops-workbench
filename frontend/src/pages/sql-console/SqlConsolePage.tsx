import { useState, useEffect } from 'react';
import { Card, Select, Button, Table, message, Space, Tag, Alert } from 'antd';
import { PlayCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

export default function SqlConsolePage() {
  const { t } = useTranslation();
  const [datasources, setDatasources] = useState<any[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | null>(null);
  const [sql, setSql] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    api.get('/datasource').then(res => setDatasources(res.data.items || [])).catch(() => {});
  }, []);

  const handleExecute = async () => {
    if (!selectedDs || !sql.trim()) {
      message.warning('请选择数据源并输入 SQL');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/sql-console/execute', {
        datasource_id: selectedDs,
        sql: sql.trim(),
      });
      setResult(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'SQL 执行失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selectedDs || !sql.trim()) return;
    setExportLoading(true);
    try {
      const res = await api.post('/sql-console/export', {
        datasource_id: selectedDs,
        sql: sql.trim(),
      }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'query_result.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error('导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  };

  const columns = result?.columns?.map((col: string) => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
    width: 150,
  })) || [];

  const dataSource = result?.rows?.map((row: string[], i: number) => {
    const obj: any = { _key: i };
    result.columns?.forEach((col: string, ci: number) => {
      obj[col] = row[ci];
    });
    return obj;
  }) || [];

  return (
    <div>
      <Card title={t('sqlConsole.title')}>
        <Alert message={t('sqlConsole.selectOnly')} type="info" showIcon style={{ marginBottom: 12 }} />

        <Space style={{ marginBottom: 12, width: '100%' }}>
          <Select
            style={{ width: 300 }}
            value={selectedDs}
            onChange={setSelectedDs}
            placeholder={t('sqlConsole.selectDatasource')}
          >
            {datasources.map(ds => (
              <Select.Option key={ds.id} value={ds.id}>{ds.datasource_name} ({ds.db_type})</Select.Option>
            ))}
          </Select>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute} loading={loading}>
            {loading ? t('sqlConsole.executing') : t('sqlConsole.execute')} (Ctrl+Enter)
          </Button>
          {result && (
            <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exportLoading}>
              {t('sqlConsole.exportResult')}
            </Button>
          )}
        </Space>

        <textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('sqlConsole.sqlPlaceholder')}
          style={{
            width: '100%',
            minHeight: 150,
            fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
            fontSize: 14,
            padding: 12,
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            background: '#1e1e2e',
            color: '#cdd6f4',
            resize: 'vertical',
            outline: 'none',
            lineHeight: 1.6,
          }}
        />

        {result && (
          <div style={{ marginTop: 16 }}>
            <Space style={{ marginBottom: 8 }}>
              <Tag color="blue">{t('sqlConsole.rowCount')}: {result.row_count}</Tag>
              {result.truncated && <Tag color="orange">{t('sqlConsole.truncated')}</Tag>}
            </Space>
            <Table
              columns={columns}
              dataSource={dataSource}
              rowKey="_key"
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 50, showSizeChanger: true }}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
