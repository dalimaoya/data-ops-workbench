import { useState, useEffect } from 'react';
import { Card, Select, Button, Table, message, Space, Statistic, Row, Col, Tag, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

export default function DataComparePage() {
  const { t } = useTranslation();
  const [datasources, setDatasources] = useState<any[]>([]);
  const [srcDs, setSrcDs] = useState<number | null>(null);
  const [srcTable, setSrcTable] = useState('');
  const [tgtDs, setTgtDs] = useState<number | null>(null);
  const [tgtTable, setTgtTable] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    api.get('/api/datasource').then(res => setDatasources(res.data.items || [])).catch(() => {});
  }, []);

  const handleCompare = async () => {
    if (!srcDs || !srcTable || !tgtDs || !tgtTable) {
      message.warning('请填写完整的对比信息');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/api/data-compare/run', {
        source_ds_id: srcDs,
        source_table: srcTable,
        target_ds_id: tgtDs,
        target_table: tgtTable,
      });
      setResult(res.data.result);
      message.success('对比完成');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '对比失败');
    } finally {
      setLoading(false);
    }
  };

  const diffColumns = [
    { title: 'Key', dataIndex: 'key', key: 'key', render: (v: any) => v?.join(', ') },
    { title: '差异字段', dataIndex: 'diffs', key: 'diffs', render: (diffs: any) => (
      <Space direction="vertical" size={0}>
        {Object.entries(diffs || {}).map(([field, vals]: any) => (
          <div key={field}><Tag>{field}</Tag> {vals.source} → {vals.target}</div>
        ))}
      </Space>
    )},
  ];

  return (
    <div>
      <Card title={t('dataCompare.title')}>
        <Row gutter={16}>
          <Col span={6}>
            <div style={{ marginBottom: 8 }}>{t('dataCompare.sourceDs')}</div>
            <Select style={{ width: '100%' }} value={srcDs} onChange={setSrcDs} placeholder="选择数据源">
              {datasources.map(ds => <Select.Option key={ds.id} value={ds.id}>{ds.datasource_name}</Select.Option>)}
            </Select>
          </Col>
          <Col span={6}>
            <div style={{ marginBottom: 8 }}>{t('dataCompare.sourceTable')}</div>
            <Input value={srcTable} onChange={e => setSrcTable(e.target.value)} placeholder="表名" />
          </Col>
          <Col span={6}>
            <div style={{ marginBottom: 8 }}>{t('dataCompare.targetDs')}</div>
            <Select style={{ width: '100%' }} value={tgtDs} onChange={setTgtDs} placeholder="选择数据源">
              {datasources.map(ds => <Select.Option key={ds.id} value={ds.id}>{ds.datasource_name}</Select.Option>)}
            </Select>
          </Col>
          <Col span={6}>
            <div style={{ marginBottom: 8 }}>{t('dataCompare.targetTable')}</div>
            <Input value={tgtTable} onChange={e => setTgtTable(e.target.value)} placeholder="表名" />
          </Col>
        </Row>
        <div style={{ marginTop: 16 }}>
          <Button type="primary" onClick={handleCompare} loading={loading}>{t('dataCompare.runCompare')}</Button>
        </div>
      </Card>

      {result && (
        <Card style={{ marginTop: 16 }}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={4}><Statistic title="源表行数" value={result.source_row_count} /></Col>
            <Col span={4}><Statistic title="目标表行数" value={result.target_row_count} /></Col>
            <Col span={4}><Statistic title={t('dataCompare.onlyInSource')} value={result.only_in_source_count} valueStyle={{ color: '#cf1322' }} /></Col>
            <Col span={4}><Statistic title={t('dataCompare.onlyInTarget')} value={result.only_in_target_count} valueStyle={{ color: '#faad14' }} /></Col>
            <Col span={4}><Statistic title={t('dataCompare.different')} value={result.different_count} valueStyle={{ color: '#1890ff' }} /></Col>
            <Col span={4}>
              <div style={{ fontSize: 12, color: '#999' }}>{t('dataCompare.matchedFields')}</div>
              <div>{result.matched_fields?.join(', ')}</div>
            </Col>
          </Row>

          {result.different?.length > 0 && (
            <>
              <h4>{t('dataCompare.different')} (前100条)</h4>
              <Table columns={diffColumns} dataSource={result.different} rowKey={(r: any) => r.key?.join('-')}
                size="small" pagination={{ pageSize: 20 }} />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
