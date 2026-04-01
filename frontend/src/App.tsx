import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import { themeConfig } from './styles/theme';
import { useAuth } from './context/AuthContext';
import MainLayout from './layouts/MainLayout';
import Loading from './pages/Loading';
import Login from './pages/Login';
import Home from './pages/Home';
import DatasourceList from './pages/datasource/DatasourceList';
import DatasourceForm from './pages/datasource/DatasourceForm';
import TableConfigList from './pages/table-config/TableConfigList';
import TableConfigCreate from './pages/table-config/TableConfigCreate';
import TableConfigDetail from './pages/table-config/TableConfigDetail';
import FieldConfigPage from './pages/table-config/FieldConfigPage';
import MaintenanceList from './pages/data-maintenance/MaintenanceList';
import DataBrowse from './pages/data-maintenance/DataBrowse';
import ImportPage from './pages/data-maintenance/ImportPage';
import DiffPreview from './pages/data-maintenance/DiffPreview';
import LogCenter from './pages/log-center/LogCenter';
import VersionRollback from './pages/version-rollback/VersionRollback';
import UserManagement from './pages/user-management/UserManagement';
import About from './pages/About';
import PlatformBackup from './pages/platform-backup/PlatformBackup';
import DatabaseMaintenance from './pages/db-maintenance/DatabaseMaintenance';
import HealthCheckPage from './pages/health-check/HealthCheckPage';
import SchedulerPage from './pages/scheduler/SchedulerPage';
import DbManagerPage from './pages/db-manager/DbManagerPage';
import NotificationPushPage from './pages/notification-push/NotificationPushPage';
import SqlConsolePage from './pages/sql-console/SqlConsolePage';
import PluginCenterPage from './pages/plugin-center/PluginCenterPage';
import PluginGuard from './components/PluginGuard';

function RequireAuth({ children }: { children: React.JSX.Element }) {
  const { isAuthenticated, authReady } = useAuth();
  if (!authReady) {
    return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><Spin size="large" /></div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireRole({ roles, children }: { roles: string[]; children: React.JSX.Element }) {
  const { user } = useAuth();
  if (!user || (user.role !== 'superadmin' && !roles.includes(user.role))) {
    return <Navigate to="/" replace />;
  }
  return children;
}

const antdLocaleMap: Record<string, typeof zhCN> = {
  zh: zhCN,
  en: enUS,
};

function App() {
  const { i18n } = useTranslation();
  const antdLocale = antdLocaleMap[i18n.language] || zhCN;

  return (
    <ConfigProvider locale={antdLocale} theme={themeConfig}>
      <Routes>
        <Route path="/loading" element={<Loading />} />
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Home />} />
          <Route path="/datasource" element={<RequireRole roles={['admin']}><DatasourceList /></RequireRole>} />
          <Route path="/datasource/create" element={<RequireRole roles={['admin']}><DatasourceForm /></RequireRole>} />
          <Route path="/datasource/edit/:id" element={<RequireRole roles={['admin']}><DatasourceForm /></RequireRole>} />
          <Route path="/table-config" element={<RequireRole roles={['admin']}><TableConfigList /></RequireRole>} />
          <Route path="/table-config/create" element={<RequireRole roles={['admin']}><TableConfigCreate /></RequireRole>} />
          <Route path="/table-config/detail/:id" element={<RequireRole roles={['admin']}><TableConfigDetail /></RequireRole>} />
          <Route path="/table-config/fields/:id" element={<RequireRole roles={['admin']}><FieldConfigPage /></RequireRole>} />
          <Route path="/data-maintenance" element={<MaintenanceList />} />
          <Route path="/db-maintenance" element={<RequireRole roles={['admin', 'operator']}><DatabaseMaintenance /></RequireRole>} />
          <Route path="/data-maintenance/browse/:id" element={<DataBrowse />} />
          <Route path="/data-maintenance/import/:id" element={<RequireRole roles={['admin', 'operator']}><ImportPage /></RequireRole>} />
          <Route path="/data-maintenance/diff/:taskId" element={<RequireRole roles={['admin', 'operator']}><DiffPreview /></RequireRole>} />
          <Route path="/log-center" element={<LogCenter />} />
          <Route path="/version-rollback" element={<RequireRole roles={['admin']}><VersionRollback /></RequireRole>} />
          <Route path="/user-management" element={<RequireRole roles={['admin']}><UserManagement /></RequireRole>} />
          <Route path="/health-check" element={<RequireRole roles={['admin']}><HealthCheckPage /></RequireRole>} />
          <Route path="/platform-backup" element={<RequireRole roles={['admin']}><PlatformBackup /></RequireRole>} />
          <Route path="/scheduler" element={<RequireRole roles={['admin']}><SchedulerPage /></RequireRole>} />
          <Route path="/db-manager" element={<RequireRole roles={['admin']}><DbManagerPage /></RequireRole>} />
          <Route path="/notification-push" element={<RequireRole roles={['admin']}><PluginGuard pluginId="plugin-notification-push"><NotificationPushPage /></PluginGuard></RequireRole>} />
          <Route path="/sql-console" element={<RequireRole roles={['admin']}><SqlConsolePage /></RequireRole>} />
          <Route path="/plugin-center" element={<RequireRole roles={['superadmin']}><PluginCenterPage /></RequireRole>} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConfigProvider>
  );
}

export default App;
