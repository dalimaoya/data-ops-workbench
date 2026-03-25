import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import { useAuth } from './context/AuthContext';
import MainLayout from './layouts/MainLayout';
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
import ApprovalCenter from './pages/approval-center/ApprovalCenter';
import About from './pages/About';
import AIConfigPage from './pages/ai-config/AIConfigPage';
import PlatformBackup from './pages/platform-backup/PlatformBackup';
import DatabaseMaintenance from './pages/db-maintenance/DatabaseMaintenance';
import HealthCheckPage from './pages/health-check/HealthCheckPage';
import SmartImportPage from './pages/smart-import/SmartImportPage';
import SchedulerPage from './pages/scheduler/SchedulerPage';
import DbManagerPage from './pages/db-manager/DbManagerPage';
import NotifyPushConfig from './pages/notify-push/NotifyPushConfig';
import DataTrendPage from './pages/data-trend/DataTrendPage';
import DataComparePage from './pages/data-compare/DataComparePage';
import TemplateMarketPage from './pages/template-market/TemplateMarketPage';
import WebhookConfigPage from './pages/webhook-config/WebhookConfigPage';
import SqlConsolePage from './pages/sql-console/SqlConsolePage';

function RequireAuth({ children }: { children: React.JSX.Element }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireRole({ roles, children }: { roles: string[]; children: React.JSX.Element }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
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
    <ConfigProvider locale={antdLocale}>
      <Routes>
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
          <Route path="/table-config" element={<TableConfigList />} />
          <Route path="/table-config/create" element={<TableConfigCreate />} />
          <Route path="/table-config/detail/:id" element={<TableConfigDetail />} />
          <Route path="/table-config/fields/:id" element={<FieldConfigPage />} />
          <Route path="/data-maintenance" element={<MaintenanceList />} />
          <Route path="/db-maintenance" element={<DatabaseMaintenance />} />
          <Route path="/data-maintenance/browse/:id" element={<DataBrowse />} />
          <Route path="/data-maintenance/import/:id" element={<ImportPage />} />
          <Route path="/data-maintenance/diff/:taskId" element={<DiffPreview />} />
          <Route path="/smart-import" element={<SmartImportPage />} />
          <Route path="/log-center" element={<LogCenter />} />
          <Route path="/version-rollback" element={<RequireRole roles={['admin']}><VersionRollback /></RequireRole>} />
          <Route path="/approval-center" element={<RequireRole roles={['admin']}><ApprovalCenter /></RequireRole>} />
          <Route path="/user-management" element={<RequireRole roles={['admin']}><UserManagement /></RequireRole>} />
          <Route path="/ai-config" element={<RequireRole roles={['admin']}><AIConfigPage /></RequireRole>} />
          <Route path="/health-check" element={<RequireRole roles={['admin']}><HealthCheckPage /></RequireRole>} />
          <Route path="/platform-backup" element={<RequireRole roles={['admin']}><PlatformBackup /></RequireRole>} />
          <Route path="/scheduler" element={<RequireRole roles={['admin']}><SchedulerPage /></RequireRole>} />
          <Route path="/db-manager" element={<RequireRole roles={['admin']}><DbManagerPage /></RequireRole>} />
          <Route path="/notify-push-config" element={<RequireRole roles={['admin']}><NotifyPushConfig /></RequireRole>} />
          <Route path="/data-trend" element={<DataTrendPage />} />
          <Route path="/data-compare" element={<DataComparePage />} />
          <Route path="/template-market" element={<RequireRole roles={['admin']}><TemplateMarketPage /></RequireRole>} />
          <Route path="/webhook-config" element={<RequireRole roles={['admin']}><WebhookConfigPage /></RequireRole>} />
          <Route path="/sql-console" element={<RequireRole roles={['admin']}><SqlConsolePage /></RequireRole>} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConfigProvider>
  );
}

export default App;
