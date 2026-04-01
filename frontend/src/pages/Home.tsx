import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, List, Tag, Space, Typography, Empty, Segmented, DatePicker } from 'antd';
import {
  DatabaseOutlined, TableOutlined, ExportOutlined, ImportOutlined,
  EditOutlined, PlusOutlined, SettingOutlined,
  ToolOutlined, FileTextOutlined, HistoryOutlined,
  CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined,
  TrophyOutlined, ThunderboltOutlined, AlertOutlined,
} from '@ant-design/icons';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar,
} from 'recharts';
import {
  getDashboardStats, getRecentOperations,
  getDashboardTrends, getDatasourceHealth, getTopTables, getTopFields,
} from '../api/dashboard';
import type {
  DashboardStats, RecentOperation,
  TrendDay, DatasourceHealth, TopTable, TopField,
} from '../api/dashboard';
import { useTranslation } from 'react-i18next';
import { useDatasourceOnline } from '../context/DatasourceOnlineContext';

const { Text } = Typography;

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { onlineStatus } = useDatasourceOnline();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [operations, setOperations] = useState<RecentOperation[]>([]);
  const [trends, setTrends] = useState<TrendDay[]>([]);
  const [dsHealth, setDsHealth] = useState<DatasourceHealth[]>([]);
  const [topTables, setTopTables] = useState<TopTable[]>([]);
  const [topFields, setTopFields] = useState<TopField[]>([]);
  const [trendDays, setTrendDays] = useState(7);

  const fetchAll = async (days?: number) => {
    const d = days ?? trendDays;
    try {
      const [s, o, tr, h, tt, tf] = await Promise.all([
        getDashboardStats(),
        getRecentOperations(),
        getDashboardTrends(d),
        getDatasourceHealth(),
        getTopTables(d, 10),
        getTopFields(d, 10),
      ]);
      setStats(s.data);
      setOperations(Array.isArray(o.data) ? o.data : []);
      setTrends(Array.isArray(tr.data) ? tr.data : []);
      setDsHealth(Array.isArray(h.data) ? h.data : []);
      setTopTables(Array.isArray(tt.data) ? tt.data : []);
      setTopFields(Array.isArray(tf.data) ? tf.data : []);
    } catch { /* empty */ }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleDaysChange = (val: string | number) => {
    const d = Number(val);
    setTrendDays(d);
    fetchAll(d);
  };

  const statusColor = (s: string) =>
    s === 'success' ? 'green' : s === 'failed' ? 'red' : 'orange';

  const shortcuts = [
    { label: t('home.shortcutNewDs'), icon: <PlusOutlined />, path: '/datasource/create' },
    { label: t('home.shortcutTableConfig'), icon: <SettingOutlined />, path: '/table-config' },
    { label: t('home.shortcutMaintenance'), icon: <ToolOutlined />, path: '/data-maintenance' },
    { label: t('home.shortcutLogs'), icon: <FileTextOutlined />, path: '/log-center' },
    { label: t('home.shortcutRollback'), icon: <HistoryOutlined />, path: '/version-rollback' },
  ];

  const healthIcon = (status: string) => {
    if (status === 'ok') return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />;
    if (status === 'error') return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
    return <QuestionCircleOutlined style={{ color: '#d9d9d9', fontSize: 18 }} />;
  };

  const healthLabel = (status: string) => {
    if (status === 'ok') return <Tag color="success">{t('home.dsHealthOk')}</Tag>;
    if (status === 'error') return <Tag color="error">{t('home.dsHealthError')}</Tag>;
    return <Tag>{t('home.dsHealthUnknown')}</Tag>;
  };

  const dbTypeLabel = (tp: string) => {
    const map: Record<string, string> = { mysql: 'MySQL', postgresql: 'PostgreSQL', sqlserver: 'SQL Server', oracle: 'Oracle', dm: t('datasource.dbTypeDM'), kingbase: t('datasource.dbTypeKingbase'), sqlite: 'SQLite' };
    return map[tp] || tp;
  };

  const statCards = [
    { key: 'datasource', color: '#2B5AED', icon: <DatabaseOutlined />, title: t('home.datasourceCount'), value: stats?.datasource_count ?? 0, onClick: () => navigate('/datasource'), hoverable: true },
    { key: 'table', color: '#7C3AED', icon: <TableOutlined />, title: t('home.tableCount'), value: stats?.table_count ?? 0, onClick: () => navigate('/table-config'), hoverable: true },
    { key: 'export', color: '#3B82F6', icon: <ExportOutlined />, title: t('home.todayExport'), value: stats?.today_export ?? 0, valueStyle: { color: '#3B82F6' } },
    { key: 'import', color: '#22C55E', icon: <ImportOutlined />, title: t('home.todayImport'), value: stats?.today_import ?? 0, valueStyle: { color: '#22C55E' } },
    { key: 'writeback', color: '#F59E0B', icon: <EditOutlined />, title: t('home.todayWriteback'), value: stats?.today_writeback ?? 0, valueStyle: { color: '#F59E0B' } },
    { key: 'abnormal', color: '#EF4444', icon: <AlertOutlined />, title: t('home.structureAbnormal'), value: stats?.structure_abnormal ?? 0, onClick: () => navigate('/table-config'), hoverable: true, valueStyle: { color: (stats?.structure_abnormal ?? 0) > 0 ? '#EF4444' : '#22C55E' } },
  ];

  return (
    <>
      {/* Row 1: Stats */}
      <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
        {statCards.map((card) => (
          <Col span={4} key={card.key}>
            <Card
              hoverable={card.hoverable}
              onClick={card.onClick}
              size="small"
              style={{ borderLeft: `4px solid ${card.color}`, borderRadius: 12 }}
            >
              <Statistic title={card.title} value={card.value} prefix={card.icon} valueStyle={card.valueStyle} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Row 2: Trend chart with time range selector */}
      <Card
        title={t('home.trendTitle')}
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Segmented
              size="small"
              value={trendDays}
              onChange={handleDaysChange}
              options={[
                { label: '7' + t('home.dayUnit'), value: 7 },
                { label: '30' + t('home.dayUnit'), value: 30 },
                { label: '90' + t('home.dayUnit'), value: 90 },
              ]}
            />
            <DatePicker.RangePicker
              size="small"
              onChange={(_, dateStrings) => {
                if (dateStrings[0] && dateStrings[1]) {
                  const d1 = new Date(dateStrings[0]);
                  const d2 = new Date(dateStrings[1]);
                  const diff = Math.ceil((d2.getTime() - d1.getTime()) / 86400000) + 1;
                  if (diff > 0 && diff <= 365) {
                    setTrendDays(diff);
                    fetchAll(diff);
                  }
                }
              }}
            />
          </Space>
        }
      >
        {trends.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} interval={trendDays <= 7 ? 0 : trendDays <= 30 ? 2 : 6} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="export" name={t('home.trendExport')} stackId="1" stroke="#1890ff" fill="#1890ff" fillOpacity={0.3} />
              <Area type="monotone" dataKey="import" name={t('home.trendImport')} stackId="1" stroke="#52c41a" fill="#52c41a" fillOpacity={0.3} />
              <Area type="monotone" dataKey="writeback" name={t('home.trendWriteback')} stackId="1" stroke="#faad14" fill="#faad14" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty description={t('home.noTrendData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      {/* Row 3: Shortcuts + DS Health + Top Tables */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card title={t('home.shortcuts')} size="small" style={{ height: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {shortcuts.map((s) => (
                <div
                  key={s.path}
                  onClick={() => navigate(s.path)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '16px 8px', borderRadius: 8, cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(43,90,237,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 24, color: '#2B5AED', marginBottom: 4 }}>{s.icon}</span>
                  <span style={{ fontSize: 12, color: '#334155' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col span={9}>
          <Card title={<Space><DatabaseOutlined /> {t('home.dsHealthTitle')}</Space>} size="small" style={{ height: '100%' }}>
            {dsHealth.length > 0 ? (
              <List
                size="small"
                dataSource={dsHealth}
                renderItem={(item) => {
                  // Prefer global online status over backend last_test_status
                  const key = String(item.id);
                  const realStatus = key in onlineStatus
                    ? (onlineStatus[key] ? 'ok' : 'error')
                    : item.status;
                  return (
                  <List.Item style={{ padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
                      {healthIcon(realStatus)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text ellipsis style={{ display: 'block', fontWeight: 500 }}>{item.name}</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>{dbTypeLabel(item.db_type)}</Text>
                      </div>
                      <div style={{ flexShrink: 0 }}>{healthLabel(realStatus)}</div>
                    </div>
                  </List.Item>
                  );
                }}
              />
            ) : (
              <Empty description={t('home.noDatasource')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
        <Col span={9}>
          <Card title={<Space><TrophyOutlined /> {t('home.topTablesTitle')}</Space>} size="small" style={{ height: '100%' }}>
            {topTables.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(topTables.length * 28, 120)}>
                <BarChart data={topTables} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="table_name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="op_count" name={t('home.topTablesCount', { count: '' })} fill="#1890ff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description={t('home.noOperations')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Row 4: Top Fields */}
      {topFields.length > 0 && (
        <Card
          title={<Space><ThunderboltOutlined /> {t('home.topFieldsTitle')}</Space>}
          size="small"
          style={{ marginBottom: 16 }}
        >
          <ResponsiveContainer width="100%" height={Math.max(topFields.length * 28, 100)}>
            <BarChart data={topFields} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="field" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="count" name={t('home.topFieldsCount')} fill="#722ed1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Row 5: Recent Ops (alerts moved to header bell) */}
      <Card title={t('home.recentOps')} size="small" bodyStyle={{ padding: operations.length ? '0' : undefined }}>
        {operations.length > 0 ? (
          <List
            dataSource={operations}
            renderItem={(item) => (
              <List.Item style={{ padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 12 }}>
                  <Tag color={statusColor(item.operation_status)} style={{ flexShrink: 0 }}>
                    {item.operation_status === 'success' ? t('home.statusSuccess') : item.operation_status === 'failed' ? t('home.statusFailed') : item.operation_status}
                  </Tag>
                  <Text strong style={{ flexShrink: 0 }}>{item.operation_type}</Text>
                  <Text style={{ flex: 1 }}>{item.readable_desc || item.operation_message || item.target_name || '-'}</Text>
                  <Text type="secondary" style={{ flexShrink: 0, fontSize: 12 }}>{item.operator_user}</Text>
                  <Text type="secondary" style={{ flexShrink: 0, fontSize: 12 }}>{item.created_at?.replace('T', ' ').slice(0, 19)}</Text>
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={t('home.noOperations')} />
        )}
      </Card>
    </>
  );
}
