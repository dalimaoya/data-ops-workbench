import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, List, Tag, Button, Space, Typography, Empty } from 'antd';
import {
  DatabaseOutlined, TableOutlined, ExportOutlined, ImportOutlined,
  EditOutlined, WarningOutlined, PlusOutlined, SettingOutlined,
  ToolOutlined, FileTextOutlined, HistoryOutlined, RightOutlined,
  CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import {
  getDashboardStats, getRecentOperations, getAlerts,
  getDashboardTrends, getDatasourceHealth, getTopTables,
} from '../api/dashboard';
import type {
  DashboardStats, RecentOperation, Alert,
  TrendDay, DatasourceHealth, TopTable,
} from '../api/dashboard';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/* ── Mini trend chart (pure SVG, no extra lib) ── */
function TrendChart({ data }: { data: TrendDay[] }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padL = 36, padR = 16, padT = 16, padB = 32;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    let maxVal = 0;
    for (const d of data) {
      maxVal = Math.max(maxVal, d.export, d.import, d.writeback);
    }
    if (maxVal === 0) maxVal = 5;
    maxVal = Math.ceil(maxVal * 1.15);

    const xStep = plotW / Math.max(data.length - 1, 1);
    const toX = (i: number) => padL + i * xStep;
    const toY = (v: number) => padT + plotH - (v / maxVal) * plotH;

    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.fillText(String(val), padL - 6, y + 4);
    }

    ctx.textAlign = 'center';
    for (let i = 0; i < data.length; i++) {
      ctx.fillText(data[i].date, toX(i), h - 8);
    }

    const drawLine = (key: 'export' | 'import' | 'writeback', color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = toX(i);
        const y = toY(data[i][key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = color;
      for (let i = 0; i < data.length; i++) {
        ctx.beginPath();
        ctx.arc(toX(i), toY(data[i][key]), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawLine('export', '#1890ff');
    drawLine('import', '#52c41a');
    drawLine('writeback', '#faad14');

  }, [data]);

  if (data.length === 0) {
    return <Empty description={t('home.noTrendData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 220, display: 'block' }}
      />
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 8 }}>
        <Space><span style={{ display: 'inline-block', width: 12, height: 3, background: '#1890ff', borderRadius: 2 }} /> <Text type="secondary" style={{ fontSize: 12 }}>{t('home.trendExport')}</Text></Space>
        <Space><span style={{ display: 'inline-block', width: 12, height: 3, background: '#52c41a', borderRadius: 2 }} /> <Text type="secondary" style={{ fontSize: 12 }}>{t('home.trendImport')}</Text></Space>
        <Space><span style={{ display: 'inline-block', width: 12, height: 3, background: '#faad14', borderRadius: 2 }} /> <Text type="secondary" style={{ fontSize: 12 }}>{t('home.trendWriteback')}</Text></Space>
      </div>
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [operations, setOperations] = useState<RecentOperation[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [trends, setTrends] = useState<TrendDay[]>([]);
  const [dsHealth, setDsHealth] = useState<DatasourceHealth[]>([]);
  const [topTables, setTopTables] = useState<TopTable[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [s, o, a, tr, h, tt] = await Promise.all([
          getDashboardStats(),
          getRecentOperations(),
          getAlerts(),
          getDashboardTrends(),
          getDatasourceHealth(),
          getTopTables(),
        ]);
        setStats(s.data);
        setOperations(o.data);
        setAlerts(a.data);
        setTrends(tr.data);
        setDsHealth(h.data);
        setTopTables(tt.data);
      } catch { /* empty */ }
    };
    fetchAll();
  }, []);

  const statusColor = (s: string) =>
    s === 'success' ? 'green' : s === 'failed' ? 'red' : 'orange';

  const shortcuts = [
    { label: t('home.shortcutNewDs'), icon: <PlusOutlined />, path: '/datasource/create' },
    { label: t('home.shortcutTableConfig'), icon: <SettingOutlined />, path: '/table-config' },
    { label: t('home.shortcutMaintenance'), icon: <ToolOutlined />, path: '/data-maintenance' },
    { label: t('home.shortcutLogs'), icon: <FileTextOutlined />, path: '/log-center' },
    { label: t('home.shortcutRollback'), icon: <HistoryOutlined />, path: '/version-rollback' },
  ];

  const handleAlertAction = (alert: Alert) => {
    if (alert.type === 'structure_changed') {
      navigate(`/table-config/detail/${alert.target_id}`);
    } else if (alert.type === 'import_failed') {
      if (alert.table_config_id) {
        navigate(`/data-maintenance/browse/${alert.table_config_id}`);
      } else {
        navigate(`/data-maintenance`);
      }
    }
  };

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

  return (
    <Card title={t('home.title')} extra={
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('home.welcome', { name: user?.display_name || user?.username || '' })}
        {user?.role && <Tag style={{ marginLeft: 8 }}>{t(`role.${user.role}`)}</Tag>}
      </Text>
    }>
      {/* Row 1: Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={5}>
          <Card hoverable onClick={() => navigate('/datasource')} size="small">
            <Statistic title={t('home.datasourceCount')} value={stats?.datasource_count ?? 0} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={5}>
          <Card hoverable onClick={() => navigate('/table-config')} size="small">
            <Statistic title={t('home.tableCount')} value={stats?.table_count ?? 0} prefix={<TableOutlined />} />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small">
            <Statistic title={t('home.todayExport')} value={stats?.today_export ?? 0} prefix={<ExportOutlined />} valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small">
            <Statistic title={t('home.todayImport')} value={stats?.today_import ?? 0} prefix={<ImportOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title={t('home.todayWriteback')} value={stats?.today_writeback ?? 0} prefix={<EditOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
      </Row>

      {/* Row 2: Trend */}
      <Card title={t('home.trendTitle')} size="small" style={{ marginBottom: 16 }}>
        <TrendChart data={trends} />
      </Card>

      {/* Row 3 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card title={t('home.shortcuts')} size="small" style={{ height: '100%' }}>
            <Space wrap>
              {shortcuts.map((s) => (
                <Button key={s.path} icon={s.icon} onClick={() => navigate(s.path)}>{s.label}</Button>
              ))}
            </Space>
          </Card>
        </Col>
        <Col span={8}>
          <Card title={<Space><DatabaseOutlined /> {t('home.dsHealthTitle')}</Space>} size="small" style={{ height: '100%' }}>
            {dsHealth.length > 0 ? (
              <List
                size="small"
                dataSource={dsHealth}
                renderItem={(item) => (
                  <List.Item style={{ padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
                      {healthIcon(item.status)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text ellipsis style={{ display: 'block', fontWeight: 500 }}>{item.name}</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>{dbTypeLabel(item.db_type)}</Text>
                      </div>
                      <div style={{ flexShrink: 0 }}>{healthLabel(item.status)}</div>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description={t('home.noDatasource')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title={<Space><TrophyOutlined /> {t('home.topTablesTitle')}</Space>} size="small" style={{ height: '100%' }}>
            {topTables.length > 0 ? (
              <List
                size="small"
                dataSource={topTables}
                renderItem={(item, index) => (
                  <List.Item style={{ padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 22, height: 22, borderRadius: '50%', fontSize: 12, fontWeight: 600,
                        background: index === 0 ? '#ffd700' : index === 1 ? '#c0c0c0' : index === 2 ? '#cd7f32' : '#f0f0f0',
                        color: index < 3 ? '#fff' : '#999',
                      }}>
                        {index + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text ellipsis style={{ display: 'block', fontWeight: 500 }}>{item.table_name}</Text>
                        {item.datasource_name && (
                          <Text type="secondary" style={{ fontSize: 11 }}>{item.datasource_name}</Text>
                        )}
                      </div>
                      <Tag color="blue">{t('home.topTablesCount', { count: item.op_count })}</Tag>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description={t('home.noOperations')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Row 4: Alerts */}
      {alerts.length > 0 && (
        <Card
          title={
            <Space>
              <WarningOutlined style={{ color: '#faad14' }} />
              {t('home.alertsTitle')}
              <Tag color="orange">{alerts.length}</Tag>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <List
            dataSource={alerts}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="action" type="link" size="small" onClick={() => handleAlertAction(item)} icon={<RightOutlined />}>
                    {t('home.alertAction')}
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={<Space><Tag color={item.level === 'error' ? 'red' : 'orange'}>{item.title}</Tag></Space>}
                  description={
                    <Space>
                      <Text>{item.message}</Text>
                      {item.created_at && (
                        <Text type="secondary" style={{ fontSize: 12 }}>{item.created_at?.replace('T', ' ').slice(0, 19)}</Text>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Row 5: Recent Ops */}
      <Card title={t('home.recentOps')} size="small" bodyStyle={{ padding: operations.length ? '0' : undefined }}>
        {operations.length > 0 ? (
          <List
            dataSource={operations}
            renderItem={(item) => (
              <List.Item style={{ padding: '10px 16px' }}>
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
    </Card>
  );
}
