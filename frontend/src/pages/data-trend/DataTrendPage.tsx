import { useState, useEffect } from 'react';
import { Card, Table, InputNumber, Space, Statistic, Row, Col, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

export default function DataTrendPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/data-trend/overview?days=${days}`);
      setOverview(res.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOverview(); }, [days]);

  const columns = [
    { title: '表名', dataIndex: 'table_name', key: 'table_name' },
    { title: '别名', dataIndex: 'table_alias', key: 'table_alias' },
    { title: t('dataTrend.totalOps'), dataIndex: 'total_ops', key: 'total_ops', sorter: (a: any, b: any) => a.total_ops - b.total_ops },
    { title: t('dataTrend.writebackOps'), dataIndex: 'writeback_ops', key: 'writeback_ops' },
    { title: t('dataTrend.exportOps'), dataIndex: 'export_ops', key: 'export_ops' },
  ];

  const totalOps = overview?.table_stats?.reduce((s: number, t: any) => s + t.total_ops, 0) || 0;
  const totalTables = overview?.table_stats?.length || 0;

  return (
    <div>
      <Card title={t('dataTrend.title')} extra={
        <Space>
          <span>{t('dataTrend.days')}:</span>
          <InputNumber min={1} max={365} value={days} onChange={v => v && setDays(v)} style={{ width: 80 }} />
        </Space>
      }>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Statistic title={t('dataTrend.totalOps')} value={totalOps} /></Col>
          <Col span={6}><Statistic title="活跃表 / Active Tables" value={overview?.table_stats?.filter((t: any) => t.total_ops > 0).length || 0} /></Col>
          <Col span={6}><Statistic title="总纳管表" value={totalTables} /></Col>
          <Col span={6}><Statistic title={t('dataTrend.alerts')} value={overview?.alerts?.length || 0} valueStyle={{ color: overview?.alerts?.length > 0 ? '#cf1322' : '#3f8600' }} /></Col>
        </Row>

        {overview?.alerts?.map((alert: any, i: number) => (
          <Alert key={i} message={alert.message_zh} type="warning" showIcon style={{ marginBottom: 8 }} />
        ))}

        <div style={{ margin: '16px 0', padding: 16, background: '#fafafa', borderRadius: 8 }}>
          <h4>{t('dataTrend.dailyOps')}</h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
            {(overview?.daily_global || []).map((d: any) => {
              const max = Math.max(...(overview?.daily_global || []).map((x: any) => x.count), 1);
              const h = Math.max((d.count / max) * 80, 2);
              return (
                <div key={d.date} title={`${d.date}: ${d.count}`} style={{
                  flex: 1, height: h, background: '#1890ff', borderRadius: '2px 2px 0 0',
                  minWidth: 4, maxWidth: 20,
                }} />
              );
            })}
          </div>
          {overview?.daily_global?.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999', marginTop: 4 }}>
              <span>{overview.daily_global[0]?.date}</span>
              <span>{overview.daily_global[overview.daily_global.length - 1]?.date}</span>
            </div>
          )}
        </div>

        <Table columns={columns} dataSource={overview?.table_stats || []} rowKey="table_id" loading={loading}
          size="small" pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  );
}
