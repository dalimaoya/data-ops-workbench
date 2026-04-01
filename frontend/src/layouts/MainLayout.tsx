import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Dropdown, Button, Space, Tag, Modal, Form, Input, message, Badge, List, Typography, Popover, Empty, Tabs } from 'antd';
const { Text: TypoText } = Typography;
import {
  DatabaseOutlined,
  TableOutlined,
  ToolOutlined,
  FileTextOutlined,
  HistoryOutlined,
  HomeOutlined,
  UserOutlined,
  LogoutOutlined,
  TeamOutlined,
  KeyOutlined,
  EditOutlined,
  AuditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined, WarningOutlined, RightOutlined,
  CheckOutlined,
  GlobalOutlined,
  RobotOutlined,
  CloudServerOutlined,
  MedicineBoxOutlined,
  ImportOutlined,
  ScheduleOutlined,
  LockOutlined,
  ConsoleSqlOutlined,
  SendOutlined,
  LineChartOutlined,
  SwapOutlined,
  ShopOutlined,
  ApiOutlined,
  CodeOutlined,
  SettingOutlined,
  AppstoreOutlined,
  SafetyCertificateOutlined,
  FundProjectionScreenOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/request';
import { changeMyPassword, updateMyProfile } from '../api/users';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../api/notifications';
import { getAlerts } from '../api/dashboard';
import type { Alert } from '../api/dashboard';
import type { NotificationItem } from '../api/notifications';
import { useTranslation } from 'react-i18next';

const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 72;

interface MenuItem {
  key: string;
  icon: React.ReactNode;
  labelKey: string;
  roles?: string[];
  children?: MenuItem[];
  disabled?: boolean;
  upgradeTag?: boolean;
}

interface MenuGroup {
  groupLabel: string;  // i18n key or display label
  groupLabelKey: string;
  items: MenuItem[];
}

// ── Icon mapping for plugin menu items ──
// @ts-ignore reserved for dynamic plugin icon resolution
const _ICON_MAP: Record<string, React.ReactNode> = {
  'RobotOutlined': <RobotOutlined />,
  'CloudServerOutlined': <CloudServerOutlined />,
  'MedicineBoxOutlined': <MedicineBoxOutlined />,
  'ImportOutlined': <ImportOutlined />,
  'ScheduleOutlined': <ScheduleOutlined />,
  'ConsoleSqlOutlined': <ConsoleSqlOutlined />,
  'DatabaseOutlined': <DatabaseOutlined />,
  'AuditOutlined': <AuditOutlined />,
  'SendOutlined': <SendOutlined />,
  'LineChartOutlined': <LineChartOutlined />,
  'SwapOutlined': <SwapOutlined />,
  'ShopOutlined': <ShopOutlined />,
  'ApiOutlined': <ApiOutlined />,
  'CodeOutlined': <CodeOutlined />,
  'SafetyCertificateOutlined': <SafetyCertificateOutlined />,
  'FundProjectionScreenOutlined': <FundProjectionScreenOutlined />,
};

// ── Plugin menu definition: pluginName → MenuItem ──
interface PluginMenuDef {
  pluginName: string;       // matches manifest name
  menuItem: MenuItem;
  parentGroup?: string;     // key of parent submenu group, if nested
}

// ── Group 1: 数据运维 ──
// Static items (always shown)
const dataOpsStaticItems: MenuItem[] = [
  { key: '/', icon: <HomeOutlined />, labelKey: 'menu.dashboard' },
  { key: '/datasource', icon: <DatabaseOutlined />, labelKey: 'menu.datasource', roles: ['admin'] },
  {
    key: '/data-config-group',
    icon: <TableOutlined />,
    labelKey: 'menu.dataConfig',
    roles: ['admin'],
    children: [],
  },
  { key: '/data-maintenance', icon: <ToolOutlined />, labelKey: 'menu.dataMaintenance' },
];

// Plugin items in 数据运维 group
const dataOpsPluginDefs: PluginMenuDef[] = [
  // 数据配置子菜单
  { pluginName: '__static_table_config__', menuItem: { key: '/table-config', icon: <TableOutlined />, labelKey: 'menu.singleTableConfig', roles: ['admin'] }, parentGroup: '/data-config-group' },
  { pluginName: 'plugin-batch-ops', menuItem: { key: '/db-maintenance', icon: <DatabaseOutlined />, labelKey: 'menu.batchTableConfig' }, parentGroup: '/data-config-group' },
  // Top-level items in 数据运维
];

// ── Group 2: 数据管理 ──
const dataManagePluginDefs: PluginMenuDef[] = [
  { pluginName: 'plugin-db-manager', menuItem: { key: '/db-manager', icon: <ConsoleSqlOutlined />, labelKey: 'menu.dbManager', roles: ['admin'] } },
  { pluginName: 'plugin-sql-console', menuItem: { key: '/sql-console', icon: <CodeOutlined />, labelKey: 'menu.sqlConsole', roles: ['admin'] } },
];

// ── Group 3: 智能功能 ──
const smartPluginDefs: PluginMenuDef[] = [];

// ── Group 4: 运维监控 ──
const monitorPluginDefs: PluginMenuDef[] = [
  { pluginName: 'plugin-health-check', menuItem: { key: '/health-check', icon: <MedicineBoxOutlined />, labelKey: 'menu.healthCheck', roles: ['admin'] } },
  // 数据趋势已合并到工作台总览
  // { pluginName: 'plugin-data-trend', menuItem: { key: '/data-trend', icon: <LineChartOutlined />, labelKey: 'menu.dataTrend', roles: ['admin', 'operator'] } },
  { pluginName: 'plugin-scheduler', menuItem: { key: '/scheduler', icon: <ScheduleOutlined />, labelKey: 'menu.scheduler', roles: ['admin'] } },
  { pluginName: 'plugin-backup', menuItem: { key: '/platform-backup', icon: <CloudServerOutlined />, labelKey: 'menu.platformBackup', roles: ['admin'] } },
];

// ── Group 5: 集成与通知 ──
const integrationPluginDefs: PluginMenuDef[] = [
  { pluginName: 'plugin-notification-push', menuItem: { key: '/notification-push', icon: <SendOutlined />, labelKey: 'menu.notificationPush', roles: ['admin'] } },
  // 模板市场暂时隐藏，后续完善后开放
  // { pluginName: 'plugin-template-market', menuItem: { key: '/template-market', icon: <ShopOutlined />, labelKey: 'menu.templateMarket', roles: ['admin'] } },
];

// ── Group 6: 系统 ──
const systemMenuItems: MenuItem[] = [
  { key: '/log-center', icon: <FileTextOutlined />, labelKey: 'menu.logCenter' },
  { key: '/version-rollback', icon: <HistoryOutlined />, labelKey: 'menu.versionRollback', roles: ['admin'] },
  { key: '/user-management', icon: <TeamOutlined />, labelKey: 'menu.userManagement', roles: ['admin'] },
  { key: '/plugin-center', icon: <AppstoreOutlined />, labelKey: 'menu.pluginCenter', roles: ['superadmin'] },
  { key: '/about', icon: <SettingOutlined />, labelKey: 'menu.about' },
];

interface PluginStatus {
  name: string;
  loaded: boolean;
  layer?: string;
  category?: string;
  authorized?: boolean;
}

/** Collect plugin menu items from a definition list, handling parentGroup nesting. */
function collectPluginItems(
  defs: PluginMenuDef[],
  loadedSet: Set<string>,
  baseItems: MenuItem[],
): MenuItem[] {
  const topLevel: MenuItem[] = [];
  for (const def of defs) {
    // Static items (prefixed __) always show; plugin items need loaded check
    if (!def.pluginName.startsWith('__') && !loadedSet.has(def.pluginName)) continue;
    if (def.parentGroup) {
      const group = baseItems.find(i => i.key === def.parentGroup);
      if (group) {
        if (!group.children) group.children = [];
        group.children.push({ ...def.menuItem });
      }
    } else {
      topLevel.push({ ...def.menuItem });
    }
  }
  return topLevel;
}

function buildMenuGroups(loadedPlugins: PluginStatus[], _t: (key: string) => string): MenuGroup[] {
  // Extension plugins must be both loaded AND authorized to appear in menu
  const loadedSet = new Set(
    loadedPlugins
      .filter(p => p.loaded && (p.layer === 'builtin' || p.authorized !== false))
      .map(p => p.name)
  );
  const groups: MenuGroup[] = [];

  // ── Group 1: 数据运维 ──
  const dataOpsItems: MenuItem[] = dataOpsStaticItems.map(item => ({
    ...item,
    children: item.children ? item.children.map(c => ({ ...c })) : undefined,
  }));
  const dataOpsTopLevel = collectPluginItems(dataOpsPluginDefs, loadedSet, dataOpsItems);
  groups.push({
    groupLabel: '数据运维',
    groupLabelKey: 'menu.dataOpsGroup',
    items: [...dataOpsItems, ...dataOpsTopLevel],
  });

  // ── Group 2: 数据管理 ──
  const dataManageItems: MenuItem[] = [];
  for (const def of dataManagePluginDefs) {
    if (loadedSet.has(def.pluginName)) {
      dataManageItems.push({ ...def.menuItem });
    }
  }
  if (dataManageItems.length > 0) {
    groups.push({
      groupLabel: '数据管理',
      groupLabelKey: 'menu.dataManageGroup',
      items: dataManageItems,
    });
  }

  // ── Group 3: 智能功能 ──
  const smartItems: MenuItem[] = [];
  for (const def of smartPluginDefs) {
    if (loadedSet.has(def.pluginName)) {
      smartItems.push({ ...def.menuItem });
    }
  }
  if (smartItems.length > 0) {
    groups.push({
      groupLabel: '智能功能',
      groupLabelKey: 'menu.smartGroup',
      items: smartItems,
    });
  }

  // ── Group 3: 运维监控 ──
  const monitorItems: MenuItem[] = [];
  for (const def of monitorPluginDefs) {
    if (loadedSet.has(def.pluginName)) {
      monitorItems.push({ ...def.menuItem });
    }
  }
  if (monitorItems.length > 0) {
    groups.push({
      groupLabel: '运维监控',
      groupLabelKey: 'menu.monitorGroup',
      items: monitorItems,
    });
  }

  // ── Group 4: 集成与通知 ──
  const integrationItems: MenuItem[] = [];
  for (const def of integrationPluginDefs) {
    if (loadedSet.has(def.pluginName)) {
      integrationItems.push({ ...def.menuItem });
    }
  }
  if (integrationItems.length > 0) {
    groups.push({
      groupLabel: '集成与通知',
      groupLabelKey: 'menu.integrationGroup',
      items: integrationItems,
    });
  }

  // ── Group 5: 系统 ──
  groups.push({
    groupLabel: '系统',
    groupLabelKey: 'menu.systemGroup',
    items: systemMenuItems.map(item => ({ ...item })),
  });

  return groups;
}

export default function MainLayout() {
  const { t, i18n } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [collapseHover, setCollapseHover] = useState(false);
  const [collapseActive, setCollapseActive] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, login, token } = useAuth();

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdForm] = Form.useForm();
  const [pwdLoading, setPwdLoading] = useState(false);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm] = Form.useForm();
  const [profileLoading, setProfileLoading] = useState(false);

  // Plugin status
  const [pluginStatuses, setPluginStatuses] = useState<PluginStatus[]>([]);
  const menuGroups = buildMenuGroups(pluginStatuses, t);

  const refreshPluginStatus = useCallback(() => {
    api.get('/plugins/loaded')
      .then(res => {
        if (res.data.plugins) setPluginStatuses(res.data.plugins);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPluginStatus();
  }, [refreshPluginStatus]);

  // Listen for plugin toggle events from PluginCenterPage
  useEffect(() => {
    const handler = () => refreshPluginStatus();
    window.addEventListener('plugin-status-changed', handler);
    return () => window.removeEventListener('plugin-status-changed', handler);
  }, [refreshPluginStatus]);

  // v2.3: Notifications
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState<Alert[]>([]);

  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, alertRes] = await Promise.all([
        listNotifications({ page_size: 10 }),
        getAlerts(),
      ]);
      setNotifications(Array.isArray(notifRes.data.items) ? notifRes.data.items : (Array.isArray(notifRes.data) ? notifRes.data : []));
      setUnreadCount(notifRes.data.unread_count ?? 0);
      setPendingAlerts(Array.isArray(alertRes.data) ? alertRes.data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationRead(id);
      fetchNotifications();
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      fetchNotifications();
    } catch { /* ignore */ }
  };

  const handleNotifClick = (item: NotificationItem) => {
    if (item.is_read === 0) {
      handleMarkRead(item.id);
    }
    if (item.related_url) {
      navigate(item.related_url);
      setNotifOpen(false);
    }
  };

  const userRole = user?.role || '';
  const siderWidth = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  // Expand state for submenus
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Collect all navigable keys for selectedKey resolution
  const allFlatKeys: string[] = [];
  menuGroups.forEach(group => {
    group.items.forEach(item => {
      if (!item.children) {
        allFlatKeys.push(item.key);
      } else {
        item.children.forEach(c => allFlatKeys.push(c.key));
      }
    });
  });

  // Auto-expand group if a child is active
  useEffect(() => {
    menuGroups.forEach(group => {
      group.items.forEach(item => {
        if (item.children) {
          const childActive = item.children.some(c => location.pathname.startsWith(c.key));
          if (childActive) {
            setExpandedGroups(prev => ({ ...prev, [item.key]: true }));
          }
        }
      });
    });
  }, [location.pathname]);

  const selectedKey = allFlatKeys
    .filter(k => location.pathname.startsWith(k) && k !== '/')
    .sort((a, b) => b.length - a.length)[0]
    || (location.pathname === '/' ? '/' : '/');

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleChangePassword = async () => {
    try {
      const values = await pwdForm.validateFields();
      setPwdLoading(true);
      await changeMyPassword(values.old_password, values.new_password);
      message.success(t('password.changeSuccess'));
      setPwdOpen(false);
      pwdForm.resetFields();
      setTimeout(() => {
        logout();
        navigate('/login', { replace: true });
      }, 1000);
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    } finally {
      setPwdLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    try {
      const values = await profileForm.validateFields();
      setProfileLoading(true);
      await updateMyProfile(values.display_name);
      message.success(t('profile.changeSuccess'));
      setProfileOpen(false);
      profileForm.resetFields();
      if (user && token) {
        login(token, { ...user, display_name: values.display_name });
      }
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    } finally {
      setProfileLoading(false);
    }
  };

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const languageMenuItems = [
    { key: 'zh', label: t('common.langZh'), onClick: () => handleLanguageChange('zh') },
    { key: 'en', label: 'English', onClick: () => handleLanguageChange('en') },
  ];

  const userMenuItems = [
    {
      key: 'info',
      label: (
        <Space>
          <UserOutlined />
          {user?.display_name || user?.username}
          <Tag>{user?.auth_source ? '统一认证' : (t(`role.${user?.role || ''}`) || user?.role)}</Tag>
        </Space>
      ),
      disabled: true,
    },
    ...(user?.account_id ? [{
      key: 'expires-at',
      label: <span>到期时间：{user.expires_at ? new Date(user.expires_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-'}</span>,
      disabled: true,
    }, {
      key: 'verify-mode',
      label: <span>校验方式：{user.verify_mode === 'offline' ? '离线验签' : '在线校验'}</span>,
      disabled: true,
    }, { type: 'divider' as const }] : [{ type: 'divider' as const }]),
    {
      key: 'change-password',
      label: (
        <Space>
          <KeyOutlined />
          {t('header.changePassword')}
        </Space>
      ),
      onClick: () => setPwdOpen(true),
    },
    {
      key: 'change-name',
      label: (
        <Space>
          <EditOutlined />
          {t('header.changeName')}
        </Space>
      ),
      onClick: () => {
        profileForm.setFieldsValue({ display_name: user?.display_name || '' });
        setProfileOpen(true);
      },
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      label: (
        <Space>
          <LogoutOutlined />
          {t('header.logout')}
        </Space>
      ),
      onClick: handleLogout,
    },
  ];

  // ── Render a single menu item ──
  const renderMenuItem = (item: MenuItem, isChild: boolean = false, parentKey?: string) => {
    const isGroup = !!(item.children);
    const isDisabled = !!(item.disabled);

    // Role filtering
    if (item.roles && userRole !== 'superadmin' && !item.roles.includes(userRole)) return null;

    // Hide children of collapsed groups
    if (isChild && parentKey && !expandedGroups[parentKey] && !collapsed) {
      return null;
    }

    const isSelected = !isGroup && item.key === selectedKey;
    const isHovered = hoveredKey === item.key;
    const isGroupActive = isGroup && item.children?.some(c => location.pathname.startsWith(c.key));

    let bg = 'transparent';
    let border = '1px solid transparent';
    let borderLeft = '3px solid transparent';
    let textColor = '#B8C4DA';
    let iconColor = '#AAB6CC';

    if (isDisabled) {
      textColor = '#5A6478';
      iconColor = '#4A5568';
    } else if (isSelected) {
      bg = 'linear-gradient(90deg, rgba(88,141,255,0.22) 0%, rgba(48,212,191,0.14) 100%)';
      border = '1px solid rgba(122,180,255,0.18)';
      borderLeft = '3px solid #35D6C1';
      textColor = '#FFFFFF';
      iconColor = '#FFFFFF';
    } else if (isGroupActive) {
      textColor = '#E0EAFF';
      iconColor = '#8CB4FF';
    } else if (isHovered && !isDisabled) {
      bg = 'rgba(255,255,255,0.05)';
      iconColor = '#DDE8FF';
    }

    return (
      <div
        key={item.key}
        onClick={() => {
          if (isDisabled) return;
          if (isGroup) {
            toggleGroup(item.key);
          } else {
            navigate(item.key);
          }
        }}
        onMouseEnter={() => setHoveredKey(item.key)}
        onMouseLeave={() => setHoveredKey(null)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isChild && !collapsed ? 6 : 10,
          height: isChild ? 34 : 38,
          padding: collapsed ? '0' : isChild ? '0 12px 0 32px' : '0 12px',
          marginBottom: isChild ? 1 : 3,
          borderRadius: 10,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          color: textColor,
          background: bg,
          border: border,
          borderLeft: borderLeft,
          transition: 'all 0.2s ease',
          justifyContent: collapsed ? 'center' : 'flex-start',
          fontSize: isChild ? 13 : 14,
          fontWeight: isChild ? 400 : 500,
          lineHeight: '24px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            fontSize: isChild ? 14 : 18,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: 20,
            height: 20,
            transition: 'color 0.2s',
          }}
        >
          {item.icon}
        </span>
        {!collapsed && (
          <span style={{ transition: 'opacity 0.2s', opacity: 1, flex: 1 }}>
            {t(item.labelKey)}
          </span>
        )}
        {!collapsed && item.upgradeTag && (
          <Tag
            style={{
              fontSize: 10,
              lineHeight: '16px',
              padding: '0 4px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#7F8CA8',
              marginRight: 0,
              flexShrink: 0,
            }}
          >
            <LockOutlined style={{ fontSize: 9, marginRight: 2 }} />
            {t('menu.upgradeLock')}
          </Tag>
        )}
        {!collapsed && isGroup && (
          <span style={{ fontSize: 10, color: '#7F8CA8', transition: 'transform 0.2s', transform: expandedGroups[item.key] ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            ▶
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Fixed Sidebar */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: siderWidth,
          zIndex: 100,
          background: 'linear-gradient(180deg, #0B1530 0%, #0E1B3D 55%, #0A234A 100%)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.25s cubic-bezier(0.2, 0, 0, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Brand Area */}
        <div style={{ padding: '12px 12px 0 12px', flexShrink: 0 }}>
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(126,167,255,0.15)',
              borderRadius: 10,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: collapsed ? '0 6px' : '0 10px',
              overflow: 'hidden',
              transition: 'padding 0.25s',
            }}
          >
            <img
              src="/logo.png"
              alt="DataOps Workbench"
              style={{
                width: collapsed ? 36 : '100%',
                height: collapsed ? 36 : 'auto',
                maxHeight: 44,
                objectFit: collapsed ? 'cover' : 'contain',
                objectPosition: 'left',
                transition: 'all 0.25s',
              }}
            />
          </div>
        </div>

        {/* Menu Items - Grouped */}
        <div style={{ padding: '8px 10px 4px 10px', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {menuGroups.map((group, groupIdx) => (
            <div key={group.groupLabelKey}>
              {/* Group divider + label (skip for first group) */}
              {groupIdx > 0 && (
                <div style={{ margin: '8px 0 6px 0' }}>
                  <div style={{
                    height: 1,
                    background: 'rgba(255,255,255,0.08)',
                    margin: '0 4px 6px 4px',
                  }} />
                  {!collapsed && (
                    <div style={{
                      fontSize: 11,
                      color: '#5A6478',
                      padding: '0 12px',
                      marginBottom: 4,
                      fontWeight: 500,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                    }}>
                      {t(group.groupLabelKey)}
                    </div>
                  )}
                </div>
              )}

              {/* Group items */}
              {group.items.map(item => {
                if (item.roles && userRole !== 'superadmin' && !item.roles.includes(userRole)) return null;

                if (item.children) {
                  // Render group header + children
                  return (
                    <div key={item.key}>
                      {renderMenuItem(item)}
                      {item.children.map(child => renderMenuItem(child, true, item.key))}
                    </div>
                  );
                }
                return renderMenuItem(item);
              })}
            </div>
          ))}
        </div>

        {/* Bottom Collapse Button */}
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: 8,
            paddingBottom: 10,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <div
            onClick={() => setCollapsed(!collapsed)}
            onMouseEnter={() => setCollapseHover(true)}
            onMouseLeave={() => { setCollapseHover(false); setCollapseActive(false); }}
            onMouseDown={() => setCollapseActive(true)}
            onMouseUp={() => setCollapseActive(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 8,
              height: 36,
              padding: collapsed ? '0' : '0 12px',
              borderRadius: 8,
              cursor: 'pointer',
              color: '#7F8CA8',
              background: collapseActive
                ? 'rgba(88,141,255,0.16)'
                : collapseHover
                  ? 'rgba(255,255,255,0.06)'
                  : 'transparent',
              transition: 'all 0.2s ease',
            }}
          >
            {collapsed
              ? <MenuUnfoldOutlined style={{ fontSize: 19 }} />
              : <MenuFoldOutlined style={{ fontSize: 19 }} />
            }
            {!collapsed && (
              <span style={{ fontSize: 14, fontWeight: 400 }}>{t('menu.collapse')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          marginLeft: siderWidth,
          transition: 'margin-left 0.25s cubic-bezier(0.2, 0, 0, 1)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            height: 60,
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            flexShrink: 0,
          }}
        >
          <div />
          <Space size={8}>
            {/* Language Switcher */}
            <Dropdown menu={{ items: languageMenuItems, selectedKeys: [i18n.language] }} placement="bottomRight">
              <Button type="text" icon={<GlobalOutlined />}>
                {i18n.language === 'zh' ? t('common.langZh') : t('common.langEn')}
              </Button>
            </Dropdown>

            <Popover
              open={notifOpen}
              onOpenChange={setNotifOpen}
              trigger="click"
              placement="bottomRight"
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t('header.notifications')}</span>
                  {unreadCount > 0 && (
                    <Button type="link" size="small" icon={<CheckOutlined />} onClick={handleMarkAllRead}>
                      {t('header.markAllRead')}
                    </Button>
                  )}
                </div>
              }
              content={
                <div style={{ width: 380 }}>
                  <Tabs
                    size="small"
                    items={[
                      {
                        key: 'notifications',
                        label: <span>{t('header.notifications')} {unreadCount > 0 && <Badge count={unreadCount} size="small" />}</span>,
                        children: (
                          <div style={{ maxHeight: 350, overflow: 'auto' }}>
                            {notifications.length === 0 ? (
                              <Empty description={t('header.noNotifications')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            ) : (
                              <List
                                size="small"
                                dataSource={notifications}
                                renderItem={(item) => (
                                  <List.Item
                                    style={{ cursor: item.related_url ? 'pointer' : 'default', background: item.is_read === 0 ? '#f6ffed' : 'transparent', padding: '6px 4px' }}
                                    onClick={() => handleNotifClick(item)}
                                  >
                                    <List.Item.Meta
                                      title={<Space>{item.is_read === 0 && <Badge status="processing" />}<TypoText strong={item.is_read === 0} style={{ fontSize: 13 }}>{item.title}</TypoText></Space>}
                                      description={<div><div style={{ fontSize: 12, color: '#666' }}>{item.message}</div><div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{item.created_at ? new Date(item.created_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US') : ''}</div></div>}
                                    />
                                  </List.Item>
                                )}
                              />
                            )}
                          </div>
                        ),
                      },
                      {
                        key: 'alerts',
                        label: <span>{t('header.pendingAlerts')} {pendingAlerts.length > 0 && <Badge count={pendingAlerts.length} size="small" color="orange" />}</span>,
                        children: (
                          <div style={{ maxHeight: 350, overflow: 'auto' }}>
                            {pendingAlerts.length === 0 ? (
                              <Empty description={t('header.noAlerts')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            ) : (
                              <List
                                size="small"
                                dataSource={pendingAlerts}
                                renderItem={(item) => (
                                  <List.Item
                                    style={{ cursor: 'pointer', padding: '6px 4px' }}
                                    onClick={() => {
                                      if (item.type === 'structure_changed') navigate(`/table-config/detail/${item.target_id}`);
                                      else if (item.table_config_id) navigate(`/data-maintenance/browse/${item.table_config_id}`);
                                      else navigate('/data-maintenance');
                                      setNotifOpen(false);
                                    }}
                                  >
                                    <List.Item.Meta
                                      avatar={<WarningOutlined style={{ color: item.level === 'error' ? '#ff4d4f' : '#faad14', fontSize: 16 }} />}
                                      title={<TypoText style={{ fontSize: 13 }}>{item.title}</TypoText>}
                                      description={<div style={{ fontSize: 12, color: '#666' }}>{item.message}</div>}
                                    />
                                    <RightOutlined style={{ color: '#999', fontSize: 12 }} />
                                  </List.Item>
                                )}
                              />
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>
              }
            >
              <Badge count={unreadCount + pendingAlerts.length} size="small" offset={[-2, 2]}>
                <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
              </Badge>
            </Popover>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Button type="text" icon={<UserOutlined />}>
                {user?.display_name || user?.username}
              </Button>
            </Dropdown>
          </Space>
        </div>

        {/* Content */}
        <div style={{ padding: 24, minHeight: '100%', background: '#F5F7FA', flex: 1 }}>
          <Outlet />
        </div>
      </div>

      {/* Password Modal */}
      <Modal
        title={t('password.title')}
        open={pwdOpen}
        onOk={handleChangePassword}
        onCancel={() => { setPwdOpen(false); pwdForm.resetFields(); }}
        confirmLoading={pwdLoading}
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="old_password" label={t('password.oldPassword')} rules={[{ required: true, message: t('password.oldPasswordRequired') }]}>
            <Input.Password placeholder={t('password.oldPasswordPlaceholder')} />
          </Form.Item>
          <Form.Item name="new_password" label={t('password.newPassword')} rules={[{ required: true, message: t('password.newPasswordRequired') }, { min: 4, message: t('password.passwordMinLength') }]}>
            <Input.Password placeholder={t('password.newPasswordPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label={t('password.confirmPassword')}
            dependencies={['new_password']}
            rules={[
              { required: true, message: t('password.confirmPasswordRequired') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('password.passwordMismatch')));
                },
              }),
            ]}
          >
            <Input.Password placeholder={t('password.confirmPasswordPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Profile Modal */}
      <Modal
        title={t('profile.title')}
        open={profileOpen}
        onOk={handleUpdateProfile}
        onCancel={() => { setProfileOpen(false); profileForm.resetFields(); }}
        confirmLoading={profileLoading}
        destroyOnClose
      >
        <Form form={profileForm} layout="vertical">
          <Form.Item name="display_name" label={t('profile.displayName')} rules={[{ required: true, message: t('profile.displayNameRequired') }]}>
            <Input placeholder={t('profile.displayNamePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
