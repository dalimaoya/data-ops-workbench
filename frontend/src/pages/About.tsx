import { Card, Descriptions, Typography, Space, Tag, Divider, Tabs, Alert } from 'antd';
import { GithubOutlined, LinkOutlined, BookOutlined, InfoCircleOutlined, DatabaseOutlined, SafetyCertificateOutlined, HomeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import userManualContent from '../content/userManualContent';
import systemInfoContent from '../content/systemInfoContent';
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
  ];

  return (
    <Card style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ marginBottom: 4 }}>{t('about.title')}</Title>
        <Tag color="blue" style={{ fontSize: 14, padding: '2px 12px' }}>{t('about.version')}</Tag>
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
