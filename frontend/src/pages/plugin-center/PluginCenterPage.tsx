import { useState, useEffect, useMemo } from 'react';
import { Card, Switch, Tag, Input, message, Tooltip, Row, Col, Typography, Space, Badge, Modal, Descriptions } from 'antd';
import {
  RobotOutlined,
  BarChartOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ApiOutlined,
  ShopOutlined,
  SearchOutlined,
  AppstoreOutlined,
  LockOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { fetchAllPlugins, togglePlugin } from '../../api/plugins';
import type { PluginInfo } from '../../api/plugins';

const { Title, Text } = Typography;

// Category definitions
const CATEGORY_MAP: Record<string, { label: string; labelEn: string; icon: string; color: string; antIcon: React.ReactNode }> = {
  ai:          { label: 'AI 智能',    labelEn: 'AI',           icon: '🤖', color: '#722ed1', antIcon: <RobotOutlined /> },
  governance:  { label: '数据治理',   labelEn: 'Governance',   icon: '📊', color: '#1890ff', antIcon: <BarChartOutlined /> },
  report:      { label: '报表审计',   labelEn: 'Reports',      icon: '📋', color: '#fa8c16', antIcon: <FileTextOutlined /> },
  workflow:    { label: '流程协作',   labelEn: 'Workflow',     icon: '✅', color: '#52c41a', antIcon: <CheckCircleOutlined /> },
  integration: { label: '外部集成',  labelEn: 'Integration',  icon: '🔗', color: '#13c2c2', antIcon: <ApiOutlined /> },
  market:      { label: '资源市场',   labelEn: 'Market',       icon: '🏪', color: '#eb2f96', antIcon: <ShopOutlined /> },
};

const ALL_CATEGORIES = ['all', 'ai', 'governance', 'report', 'workflow', 'integration', 'market'];

export default function PluginCenterPage() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'superadmin';
  const isZh = i18n.language === 'zh';

  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [toggling, setToggling] = useState<string | null>(null);
  const [detailPlugin, setDetailPlugin] = useState<PluginInfo | null>(null);

  const loadPlugins = async () => {
    try {
      setLoading(true);
      const data = await fetchAllPlugins();
      // Only show extension plugins in plugin center
      setPlugins(data.filter(p => p.layer === 'extension'));
    } catch {
      message.error('加载插件列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPlugins(); }, []);

  const filteredPlugins = useMemo(() => {
    let list = plugins;
    if (activeCategory !== 'all') {
      list = list.filter(p => p.category === activeCategory);
    }
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      list = list.filter(p =>
        (p.display_name || '').toLowerCase().includes(kw) ||
        (p.display_name_en || '').toLowerCase().includes(kw) ||
        (p.description || '').toLowerCase().includes(kw) ||
        (p.name || '').toLowerCase().includes(kw)
      );
    }
    return list;
  }, [plugins, activeCategory, search]);

  const handleToggle = async (plugin: PluginInfo, checked: boolean) => {
    if (!isAdmin) {
      message.warning('仅管理员可操作');
      return;
    }
    setToggling(plugin.name);
    try {
      const res = await togglePlugin(plugin.name, checked);
      message.success(res.message || (checked ? '插件已启用' : '插件已停用'));
      // Update local state and notify nav to refresh (no page reload needed)
      setPlugins(prev => prev.map(p =>
        p.name === plugin.name ? { ...p, enabled: checked } : p
      ));
      window.dispatchEvent(new CustomEvent('plugin-status-changed'));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    } finally {
      setToggling(null);
    }
  };

  const getCategoryInfo = (cat: string) => CATEGORY_MAP[cat] || { label: cat, labelEn: cat, icon: '📦', color: '#666', antIcon: <AppstoreOutlined /> };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ marginBottom: 4 }}>
          🧩 {isZh ? '插件中心' : 'Plugin Center'}
        </Title>
        <Text type="secondary">
          {isZh ? '管理扩展插件，启用后在导航栏显示对应功能入口' : 'Manage extension plugins. Enabled plugins appear in the navigation bar.'}
        </Text>
      </div>

      {/* Search + Category Filter */}
      <div style={{ marginBottom: 20 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={isZh ? '搜索插件名称或描述...' : 'Search plugins...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          allowClear
          style={{ width: 320, marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ALL_CATEGORIES.map(cat => {
            const isActive = activeCategory === cat;
            if (cat === 'all') {
              return (
                <Tag
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    cursor: 'pointer',
                    padding: '4px 12px',
                    borderRadius: 16,
                    fontSize: 13,
                    background: isActive ? '#1890ff' : '#f5f5f5',
                    color: isActive ? '#fff' : '#666',
                    border: isActive ? '1px solid #1890ff' : '1px solid #d9d9d9',
                  }}
                >
                  {isZh ? '全部' : 'All'}
                </Tag>
              );
            }
            const info = getCategoryInfo(cat);
            return (
              <Tag
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 12px',
                  borderRadius: 16,
                  fontSize: 13,
                  background: isActive ? info.color : '#f5f5f5',
                  color: isActive ? '#fff' : '#666',
                  border: isActive ? `1px solid ${info.color}` : '1px solid #d9d9d9',
                }}
              >
                {info.icon} {isZh ? info.label : info.labelEn}
              </Tag>
            );
          })}
        </div>
      </div>

      {/* Plugin Cards Grid */}
      <Row gutter={[16, 16]}>
        {filteredPlugins.map(plugin => {
          const catInfo = getCategoryInfo(plugin.category);
          const isLicenseRequired = plugin.license === 'required';
          const isUnauthorized = plugin.authorized === false;

          return (
            <Col key={plugin.name} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                onClick={() => setDetailPlugin(plugin)}
                style={{
                  borderRadius: 12,
                  border: plugin.enabled && !isUnauthorized ? `1px solid ${catInfo.color}33` : '1px solid #f0f0f0',
                  background: plugin.enabled && !isUnauthorized ? `${catInfo.color}05` : '#fff',
                  opacity: isUnauthorized ? 0.75 : 1,
                  height: '100%',
                  cursor: 'pointer',
                }}
                bodyStyle={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}
              >
                {/* Top: Icon + Switch */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: `${catInfo.color}15`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                    }}
                  >
                    {catInfo.icon}
                  </div>
                  <Space size={4}>
                    {(isLicenseRequired || isUnauthorized) && (
                      <Tooltip title={isZh ? '需要授权' : 'Authorization required'}>
                        <LockOutlined style={{ color: '#faad14', fontSize: 16 }} />
                      </Tooltip>
                    )}
                    <Tooltip title={isUnauthorized ? (isZh ? '需要授权' : 'Authorization required') : (!isAdmin ? (isZh ? '仅管理员可操作' : 'Admin only') : '')}>
                      <span onClick={e => e.stopPropagation()}>
                        <Switch
                          checked={plugin.enabled}
                          loading={toggling === plugin.name}
                          disabled={!isAdmin || isUnauthorized}
                          onChange={checked => handleToggle(plugin, checked)}
                          size="small"
                        />
                      </span>
                    </Tooltip>
                  </Space>
                </div>

                {/* Name */}
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: '#1a1a2e' }}>
                  {isZh ? plugin.display_name : plugin.display_name_en}
                </div>

                {/* Description */}
                <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 12, flex: 1, lineHeight: 1.5 }}>
                  {plugin.description || (isZh ? '暂无描述' : 'No description')}
                </div>

                {/* Bottom: Category tag + Version */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Tag
                    style={{
                      fontSize: 11,
                      borderRadius: 10,
                      padding: '0 8px',
                      color: catInfo.color,
                      background: `${catInfo.color}10`,
                      border: `1px solid ${catInfo.color}30`,
                    }}
                  >
                    {isZh ? catInfo.label : catInfo.labelEn}
                  </Tag>
                  {plugin.version && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      v{plugin.version}
                    </Text>
                  )}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Empty state */}
      {!loading && filteredPlugins.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
          <AppstoreOutlined style={{ fontSize: 48, marginBottom: 16 }} />
          <div>{isZh ? '没有找到匹配的插件' : 'No plugins found'}</div>
        </div>
      )}

      {/* Plugin Detail Modal */}
      <Modal
        title={
          <Space>
            <span style={{ fontSize: 20 }}>{detailPlugin ? getCategoryInfo(detailPlugin.category).icon : ''}</span>
            {detailPlugin ? (isZh ? detailPlugin.display_name : detailPlugin.display_name_en) : ''}
          </Space>
        }
        open={!!detailPlugin}
        onCancel={() => setDetailPlugin(null)}
        footer={null}
        width={520}
      >
        {detailPlugin && (() => {
          const catInfo = getCategoryInfo(detailPlugin.category);
          return (
            <>
              <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
                <Descriptions.Item label={isZh ? '插件标识' : 'Plugin ID'}>{detailPlugin.name}</Descriptions.Item>
                <Descriptions.Item label={isZh ? '分类' : 'Category'}>
                  <Tag style={{ color: catInfo.color, background: `${catInfo.color}10`, border: `1px solid ${catInfo.color}30` }}>
                    {catInfo.icon} {isZh ? catInfo.label : catInfo.labelEn}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={isZh ? '版本' : 'Version'}>{detailPlugin.version || '-'}</Descriptions.Item>
                <Descriptions.Item label={isZh ? '状态' : 'Status'}>
                  <Badge status={detailPlugin.enabled ? 'success' : 'default'} text={detailPlugin.enabled ? (isZh ? '已启用' : 'Enabled') : (isZh ? '已停用' : 'Disabled')} />
                </Descriptions.Item>
                {detailPlugin.license && (
                  <Descriptions.Item label={isZh ? '授权' : 'License'}>{detailPlugin.license}</Descriptions.Item>
                )}
              </Descriptions>
              <div style={{ marginBottom: 16 }}>
                <Text strong>{isZh ? '描述' : 'Description'}</Text>
                <div style={{ marginTop: 8, color: '#666', lineHeight: 1.8 }}>
                  {detailPlugin.description || (isZh ? '暂无描述' : 'No description')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Space>
                  {detailPlugin.authorized === false && (
                    <Tag color="warning" icon={<LockOutlined />}>{isZh ? '需要授权' : 'Authorization required'}</Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>{isZh ? '启用/停用：' : 'Enable/Disable:'}</Text>
                  <Switch
                    checked={detailPlugin.enabled}
                    loading={toggling === detailPlugin.name}
                    disabled={!isAdmin || detailPlugin.authorized === false}
                    onChange={checked => {
                      handleToggle(detailPlugin, checked);
                      setDetailPlugin({ ...detailPlugin, enabled: checked });
                    }}
                  />
                </Space>
              </div>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
