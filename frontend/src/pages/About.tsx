import { useCallback, useEffect, useState } from 'react';
import { Card, Descriptions, Typography, Space, Tag, Divider, Tabs, Alert, Button, Modal, Input, List, message } from 'antd';
import { GithubOutlined, LinkOutlined, BookOutlined, InfoCircleOutlined, DatabaseOutlined, SafetyCertificateOutlined, HomeOutlined, KeyOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import userManualContent from '../content/userManualContent';
import systemInfoContent from '../content/systemInfoContent';
import { api } from '../api/request';
import type { Components } from 'react-markdown';

const { Title, Paragraph, Link, Text } = Typography;

const databases = [
  { name: 'MySQL', versions: '5.7+ / 8.0+', port: '3306' },
  { name: 'PostgreSQL', versions: '10+', port: '5432' },
  { name: 'SQL Server', versions: '2012+', port: '1433' },
  { name: 'Oracle', versions: '11g+', port: '1521' },
  { name: '达梦 (DM)', versions: 'DM8', port: '5236' },
  { name: '人大金仓 (KingbaseES)', versions: 'V8+', port: '54321' },
  { name: 'SQLite', versions: '3.x', port: '—' },
];

// Markdown renderer style overrides for antd compatibility
const markdownStyles: React.CSSProperties = {
  lineHeight: 1.8,
  fontSize: 14,
};

const mdTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: 16,
  fontSize: 13,
};

const mdThStyle: React.CSSProperties = {
  border: '1px solid #f0f0f0',
  padding: '8px 12px',
  textAlign: 'left',
  background: '#fafafa',
  fontWeight: 600,
};

const mdTdStyle: React.CSSProperties = {
  border: '1px solid #f0f0f0',
  padding: '8px 12px',
};

const mdComponents: Partial<Components> = {
  table: ({ children, ...props }) => (
    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={mdTableStyle} {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }) => <th style={mdThStyle} {...props}>{children}</th>,
  td: ({ children, ...props }) => <td style={mdTdStyle} {...props}>{children}</td>,
  h1: ({ children }) => <Title level={2} style={{ marginTop: 32 }}>{children}</Title>,
  h2: ({ children }) => <Title level={3} style={{ marginTop: 28 }}>{children}</Title>,
  h3: ({ children }) => <Title level={4} style={{ marginTop: 20 }}>{children}</Title>,
  h4: ({ children }) => <Title level={5} style={{ marginTop: 16 }}>{children}</Title>,
  h5: ({ children }) => <Title level={5} style={{ marginTop: 12, fontSize: 14 }}>{children}</Title>,
  p: ({ children }) => <Paragraph style={{ marginBottom: 12 }}>{children}</Paragraph>,
  blockquote: ({ children }) => (
    <div style={{
      borderLeft: '4px solid #1677ff',
      paddingLeft: 16,
      margin: '12px 0',
      color: '#666',
      background: '#f6f8fa',
      padding: '12px 16px',
      borderRadius: '0 6px 6px 0',
    }}>
      {children}
    </div>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <pre style={{
          background: '#f6f8fa',
          padding: '12px 16px',
          borderRadius: 6,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          border: '1px solid #e8e8e8',
          fontFamily: "'Courier New', Consolas, 'Liberation Mono', monospace",
        }}>
          <code style={{ fontFamily: 'inherit' }}>{children}</code>
        </pre>
      );
    }
    return (
      <code style={{
        background: '#f0f0f0',
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 13,
      }}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  hr: () => <Divider />,
  a: ({ href, children }) => <Link href={href} target="_blank">{children}</Link>,
  strong: ({ children }) => <Text strong>{children}</Text>,
  ul: ({ children }) => <ul style={{ paddingLeft: 24, marginBottom: 12 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: 24, marginBottom: 12 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
};

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div style={markdownStyles}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function OverviewTab({ isZh }: { isZh: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {/* Feature Description */}
      <Title level={5}>{t('about.featureTitle')}</Title>
      <Paragraph>{t('about.featureDesc')}</Paragraph>

      <Divider />

      {/* Supported Databases */}
      <Title level={5}><DatabaseOutlined style={{ marginRight: 8 }} />{t('about.supportedDatabases')}</Title>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ background: '#fafafa' }}>
            <th style={{ border: '1px solid #f0f0f0', padding: '8px 12px', textAlign: 'left' }}>{isZh ? '数据库' : 'Database'}</th>
            <th style={{ border: '1px solid #f0f0f0', padding: '8px 12px', textAlign: 'left' }}>{isZh ? '版本要求' : 'Version'}</th>
            <th style={{ border: '1px solid #f0f0f0', padding: '8px 12px', textAlign: 'left' }}>{isZh ? '默认端口' : 'Port'}</th>
          </tr>
        </thead>
        <tbody>
          {databases.map((db) => (
            <tr key={db.name}>
              <td style={{ border: '1px solid #f0f0f0', padding: '8px 12px' }}><Text strong>{db.name}</Text></td>
              <td style={{ border: '1px solid #f0f0f0', padding: '8px 12px' }}>{db.versions}</td>
              <td style={{ border: '1px solid #f0f0f0', padding: '8px 12px' }}>{db.port}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider />

      {/* Repository Links */}
      <Title level={5}>{t('about.projectRepo')}</Title>
      <Space direction="vertical" size={8} style={{ marginBottom: 16 }}>
        <Space>
          <GithubOutlined />
          <Link href="https://github.com/dalimaoya/data-ops-workbench" target="_blank">
            GitHub: dalimaoya/data-ops-workbench
          </Link>
        </Space>
        <Space>
          <LinkOutlined />
          <Link href="https://gitee.com/dalimaoya/data-ops-workbench" target="_blank">
            Gitee: dalimaoya/data-ops-workbench
          </Link>
        </Space>
      </Space>

      <Divider />

      {/* Tech Stack */}
      <Title level={5}>{t('about.techStack')}</Title>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('about.frontend')}>React 19 + TypeScript + Ant Design 6 + Vite</Descriptions.Item>
        <Descriptions.Item label={t('about.backend')}>Python FastAPI + SQLAlchemy 2.0 + Pydantic 2</Descriptions.Item>
        <Descriptions.Item label={t('about.database')}>SQLite (platform) + 7 datasource types (MySQL / PG / SS / Oracle / DM / KingbaseES / SQLite)</Descriptions.Item>
        <Descriptions.Item label={t('about.templateEngine')}>openpyxl (Excel Import/Export)</Descriptions.Item>
        <Descriptions.Item label={isZh ? 'AI 引擎' : 'AI Engine'}>{isZh ? '内置规则 / 本地模型 / 云端大模型（9 平台预设）' : 'Built-in rules / Local model / Cloud LLM (9 presets)'}</Descriptions.Item>
      </Descriptions>

      <Divider />

      {/* License */}
      <Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 0 }}>
        <SafetyCertificateOutlined style={{ marginRight: 4 }} />
        {t('about.license')}: {t('about.licenseText')}
      </Paragraph>
    </>
  );
}

interface ActivationRecordItem {
  id: number;
  code: string;
  product: string;
  plugin_keys: string[];
  expires_at: string | null;
  activated_at: string;
}

const PLUGIN_LABELS: Record<string, string> = {
  plugin_ai_assistant: 'AI 智能助手',
  plugin_ai_predict: 'AI 数据预填',
  plugin_approval: '审批流',
  plugin_audit_export: '审计报告导出',
  plugin_data_compare: '跨库数据对比',
  plugin_data_mask: '数据脱敏导出',
  plugin_data_trend: '数据变更趋势',
  plugin_notify_push: '外部通知推送',
  plugin_report: '数据对比报告',
  plugin_smart_import: '智能数据导入',
  plugin_template_market: '模板市场',
  plugin_webhook: 'Webhook 集成',
};

function ActivationTab() {
  const [records, setRecords] = useState<ActivationRecordItem[]>([]);
  const [trialStatus, setTrialStatus] = useState<{ active: boolean; expires_at: string | null; days_remaining: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [activating, setActivating] = useState(false);

  const loadRecords = useCallback(async () => {
    try {
      const res = await api.get('/activation/records');
      setRecords(res.data);
    } catch {
      // silent
    }
  }, []);

  const loadTrialStatus = useCallback(async () => {
    try {
      const res = await api.get('/plugins/trial-status');
      setTrialStatus(res.data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadRecords();
    loadTrialStatus();
  }, [loadRecords, loadTrialStatus]);

  const handleActivate = async () => {
    const trimmed = codeInput.trim();
    if (!trimmed) return;

    // Support both simple code string (ACT:XXXX-XXXX-XXXX) and JSON payload
    let payload: any;
    if (trimmed.startsWith('{')) {
      try {
        payload = JSON.parse(trimmed);
      } catch {
        message.error('JSON 格式无效');
        return;
      }
    } else {
      // Simple activation code string — send as code field
      payload = { code: trimmed };
    }

    setActivating(true);
    try {
      const res = await api.post('/activation/activate', payload);
      message.success(res.data.message || '激活成功');
      setCodeInput('');
      setModalOpen(false);
      loadRecords();
      loadTrialStatus();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '激活失败');
    } finally {
      setActivating(false);
    }
  };

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return '永久';
    const d = new Date(expiresAt);
    const now = new Date();
    const label = d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
    return d < now ? `已过期 (${label})` : `至 ${label}`;
  };

  return (
    <>
      {/* Trial status */}
      {trialStatus && (
        <Alert
          style={{ marginBottom: 16 }}
          type={trialStatus.active ? 'success' : 'warning'}
          showIcon
          message={trialStatus.active
            ? `全插件试用中 — 剩余 ${trialStatus.days_remaining} 天（到期：${formatExpiry(trialStatus.expires_at)}）`
            : '试用已过期，请输入激活码解锁插件功能'
          }
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>已激活插件</Typography.Title>
        <Button type="primary" icon={<KeyOutlined />} onClick={() => setModalOpen(true)}>
          输入激活码
        </Button>
      </div>

      {records.length === 0 ? (
        <Alert message="暂无通过激活码激活的插件" description={trialStatus?.active ? '当前处于试用期，所有扩展插件已自动开放。' : '请点击右上方按钮输入激活码以解锁插件功能。'} type="info" showIcon />
      ) : (
        <List
          bordered
          dataSource={records}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={<CheckCircleOutlined style={{ fontSize: 20, color: '#52c41a' }} />}
                title={
                  <Space>
                    {item.plugin_keys.map((k) => (
                      <Tag key={k} color="blue">{PLUGIN_LABELS[k] || k}</Tag>
                    ))}
                  </Space>
                }
                description={
                  <Space split={<Divider type="vertical" />}>
                    <span>有效期：{formatExpiry(item.expires_at)}</span>
                    <span>激活时间：{new Date(item.activated_at).toLocaleDateString('zh-CN')}</span>
                    <Typography.Text type="secondary" copyable={{ text: item.code }} style={{ fontSize: 12 }}>
                      {item.code.substring(0, 12)}...
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}

      <Modal
        title="插件激活"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleActivate}
        okText="激活"
        cancelText="取消"
        confirmLoading={activating}
        width={420}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          请输入从管理员处获取的激活码。
        </Typography.Paragraph>
        <Input
          size="large"
          placeholder="ACT:XXXX-XXXX-XXXX-XXXX"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          onPressEnter={handleActivate}
          style={{ fontFamily: 'monospace', letterSpacing: 1 }}
        />
      </Modal>
    </>
  );
}

export default function About() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh';

  const tabItems = [
    {
      key: 'overview',
      label: (
        <Space>
          <HomeOutlined />
          {isZh ? '概览' : 'Overview'}
        </Space>
      ),
      children: <OverviewTab isZh={isZh} />,
    },
    {
      key: 'user-manual',
      label: (
        <Space>
          <BookOutlined />
          {t('about.userManual')}
        </Space>
      ),
      children: (
        <>
          {!isZh && (
            <Alert
              message="Documentation available in Chinese"
              description="The user manual is currently available in Chinese. English translation is planned for a future release."
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <MarkdownViewer content={userManualContent} />
        </>
      ),
    },
    {
      key: 'system-info',
      label: (
        <Space>
          <InfoCircleOutlined />
          {t('about.systemInfo')}
        </Space>
      ),
      children: (
        <>
          {!isZh && (
            <Alert
              message="Documentation available in Chinese"
              description="The system documentation is currently available in Chinese. English translation is planned for a future release."
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <MarkdownViewer content={systemInfoContent} />
        </>
      ),
    },
    {
      key: 'activation',
      label: (
        <Space>
          <KeyOutlined />
          {isZh ? '插件激活' : 'Activation'}
        </Space>
      ),
      children: <ActivationTab />,
    },
  ];

  const [updateChecking, setUpdateChecking] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(t('about.version'));

  useEffect(() => {
    api.get('/auth/check-update').then(res => {
      if (res.data.current_version) setCurrentVersion('v' + res.data.current_version);
    }).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    try {
      const res = await api.get('/auth/check-update');
      if (res.data.has_update) {
        Modal.info({
          title: '发现新版本',
          content: (
            <div>
              <p>当前版本：{res.data.current_version}</p>
              <p>最新版本：{res.data.latest_version}</p>
              {res.data.release_name && <p>版本名称：{res.data.release_name}</p>}
              {res.data.release_body && <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#666' }}>{res.data.release_body}</p>}
              {res.data.release_url && <p><a href={res.data.release_url} target="_blank" rel="noopener noreferrer">前往下载页面</a></p>}
            </div>
          ),
        });
      } else if (res.data.error) {
        message.warning(res.data.error);
      } else {
        message.success(`当前已是最新版本 (${res.data.current_version})`);
      }
    } catch {
      message.error('检查更新失败，请稍后重试');
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <Card style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ marginBottom: 4 }}>{t('about.title')}</Title>
        <Space>
          <Tag color="blue" style={{ fontSize: 14, padding: '2px 12px' }}>{currentVersion}</Tag>
          <Button size="small" loading={updateChecking} onClick={handleCheckUpdate}>检查更新</Button>
        </Space>
      </div>

      <Tabs
        defaultActiveKey="overview"
        items={tabItems}
        size="large"
        style={{ marginTop: 8 }}
      />
    </Card>
  );
}
