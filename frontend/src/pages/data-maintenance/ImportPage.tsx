import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Upload, Button, Space, message, Descriptions, Alert, Tabs, Tag, Tooltip, Collapse } from 'antd';
import { InboxOutlined, ArrowLeftOutlined, ExclamationCircleOutlined, InfoCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { importTemplate } from '../../api/dataMaintenance';
import type { ImportResult, AIWarningItem } from '../../api/dataMaintenance';
import { useTranslation } from 'react-i18next';

const { Dragger } = Upload;
const { Panel } = Collapse;

const CHECK_TYPE_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  outlier: { zh: '异常值', en: 'Outlier', color: 'orange' },
  format: { zh: '格式不一致', en: 'Format', color: 'blue' },
  duplicate: { zh: '重复值', en: 'Duplicate', color: 'purple' },
  cross_field: { zh: '跨字段逻辑', en: 'Cross-field', color: 'red' },
  ai_insight: { zh: 'AI 洞察', en: 'AI Insight', color: 'cyan' },
};

export default function ImportPage() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tableConfigId = Number(id);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  const handleUpload = async () => {
    if (!file) {
      message.warning(t('importPage.selectFileFirst'));
      return;
    }
    setUploading(true);
    try {
      const res = await importTemplate(tableConfigId, file);
      setResult(res.data);
      if (res.data.validation_status === 'failed') {
        message.error(t('importPage.validationFailedMsg'));
      } else {
        message.success(t('importPage.validationComplete'));
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || t('importPage.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  if (result) {
    const aiWarnings = result.ai_warnings || [];
    const aiWarningCount = result.ai_warnings_count || aiWarnings.length;
    const hasAIWarnings = aiWarningCount > 0;

    // Filter data based on active tab
    const filteredErrors = activeTab === 'all' || activeTab === 'errors' ? result.errors : [];
    const filteredAIWarnings = activeTab === 'all' || activeTab === 'ai_warnings' ? aiWarnings : [];

    return (
      <div>
        <Card
          title={
            <Space>
              <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => setResult(null)} />
              <span>{t('importPage.validationResult')}</span>
            </Space>
          }
        >
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <Card size="small" style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{result.total}</div>
              <div style={{ color: '#666' }}>{t('importPage.totalRecords')}</div>
            </Card>
            <Card size="small" style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: '#52c41a' }}>{result.passed}</div>
              <div style={{ color: '#666' }}>{t('importPage.passed')}</div>
            </Card>
            <Card size="small" style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: '#ff4d4f' }}>{result.failed}</div>
              <div style={{ color: '#666' }}>{t('importPage.failedCount')}</div>
            </Card>
            <Card size="small" style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: '#faad14' }}>{result.warnings}</div>
              <div style={{ color: '#666' }}>{t('importPage.warnings')}</div>
            </Card>
            {hasAIWarnings && (
              <Card size="small" style={{ flex: 1, minWidth: 120, textAlign: 'center', borderColor: '#722ed1' }}>
                <div style={{ fontSize: 28, fontWeight: 'bold', color: '#722ed1' }}>{aiWarningCount}</div>
                <div style={{ color: '#666' }}>
                  <RobotOutlined style={{ marginRight: 4 }} />
                  {isZh ? 'AI 警告' : 'AI Warnings'}
                </div>
              </Card>
            )}
            <Card size="small" style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: '#1890ff' }}>{result.diff_count}</div>
              <div style={{ color: '#666' }}>{t('importPage.diffCount')}</div>
            </Card>
          </div>

          {/* Validation status */}
          {result.validation_status === 'failed' && (
            <Alert type="error" message={t('importPage.validationFailed')} style={{ marginBottom: 16 }} />
          )}
          {result.validation_status === 'partial' && (
            <Alert type="warning" message={t('importPage.validationPartial')} style={{ marginBottom: 16 }} />
          )}
          {result.validation_status === 'success' && (
            <Alert type="success" message={t('importPage.validationSuccess')} style={{ marginBottom: 16 }} />
          )}

          {/* Tabs for filtering */}
          {(result.errors.length > 0 || hasAIWarnings) && (
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'all',
                  label: isZh ? '全部' : 'All',
                },
                {
                  key: 'errors',
                  label: (
                    <span>
                      <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />
                      {isZh ? `错误 (${result.errors.length})` : `Errors (${result.errors.length})`}
                    </span>
                  ),
                },
                ...(hasAIWarnings ? [{
                  key: 'ai_warnings',
                  label: (
                    <span>
                      <RobotOutlined style={{ color: '#722ed1', marginRight: 4 }} />
                      {isZh ? `AI 警告 (${aiWarningCount})` : `AI Warnings (${aiWarningCount})`}
                    </span>
                  ),
                }] : []),
                {
                  key: 'passed',
                  label: isZh ? '通过' : 'Passed',
                },
              ]}
            />
          )}

          {/* Error details */}
          {filteredErrors.length > 0 && (
            <Card
              title={
                <Space>
                  <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                  {t('importPage.errorDetails')}
                </Space>
              }
              size="small"
              style={{ marginBottom: 16 }}
            >
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>{t('importPage.errorRow')}</th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>{t('importPage.errorField')}</th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>{t('importPage.errorType')}</th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>{t('importPage.errorValue')}</th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'left' }}>{t('importPage.errorMessage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredErrors.map((e, i) => (
                      <tr key={i}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>{e.row}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>{e.field}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
                          <Tag color="error">⛔ {e.type}</Tag>
                        </td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>{e.value || '-'}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* AI Warnings */}
          {filteredAIWarnings.length > 0 && (
            <Card
              title={
                <Space>
                  <RobotOutlined style={{ color: '#722ed1' }} />
                  {isZh ? 'AI 智能校验警告' : 'AI Smart Validation Warnings'}
                </Space>
              }
              size="small"
              style={{ marginBottom: 16, borderColor: '#d3adf7' }}
            >
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9f0ff' }}>
                      <th style={{ padding: '8px', borderBottom: '1px solid #d3adf7', textAlign: 'left', width: 60 }}>
                        {isZh ? '行号' : 'Row'}
                      </th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #d3adf7', textAlign: 'left', width: 120 }}>
                        {isZh ? '字段' : 'Field'}
                      </th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #d3adf7', textAlign: 'left', width: 120 }}>
                        {isZh ? '当前值' : 'Value'}
                      </th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #d3adf7', textAlign: 'left', width: 110 }}>
                        {isZh ? '类型' : 'Type'}
                      </th>
                      <th style={{ padding: '8px', borderBottom: '1px solid #d3adf7', textAlign: 'left' }}>
                        {isZh ? '说明' : 'Description'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAIWarnings.map((w: AIWarningItem, i: number) => {
                      const typeInfo = CHECK_TYPE_LABELS[w.check_type] || { zh: w.check_type, en: w.check_type, color: 'default' };
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fafafa' : '#fff' }}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
                            {w.row === 0 ? (isZh ? '整体' : 'All') : w.row}
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>{w.column}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Tooltip title={w.value}>{w.value || '-'}</Tooltip>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
                            <Tag color={typeInfo.color}>⚠️ {isZh ? typeInfo.zh : typeInfo.en}</Tag>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
                            <div>{w.message}</div>
                            {w.detail && (
                              <Collapse ghost size="small" style={{ marginTop: 4 }}>
                                <Panel
                                  header={
                                    <span style={{ fontSize: 12, color: '#999' }}>
                                      <InfoCircleOutlined style={{ marginRight: 4 }} />
                                      {isZh ? '查看历史数据参考' : 'View historical reference'}
                                    </span>
                                  }
                                  key="detail"
                                >
                                  <div style={{ fontSize: 12, color: '#666', padding: '4px 0' }}>
                                    {w.detail}
                                    {w.historical_pattern && (
                                      <div style={{ marginTop: 4 }}>
                                        <Tag color="geekblue" style={{ fontSize: 11 }}>
                                          {isZh ? '历史模式' : 'Pattern'}: {w.historical_pattern}
                                        </Tag>
                                      </div>
                                    )}
                                  </div>
                                </Panel>
                              </Collapse>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Alert
                style={{ marginTop: 12 }}
                type="info"
                showIcon
                icon={<InfoCircleOutlined />}
                message={isZh
                  ? 'AI 警告仅为参考提示，不阻断导入。可在「AI 配置」中调整警告行为。'
                  : 'AI warnings are advisory only and do not block import. You can adjust behavior in AI Settings.'
                }
              />
            </Card>
          )}

          <Space>
            {result.validation_status !== 'failed' && result.passed > 0 && (
              <Button type="primary" onClick={() => navigate(`/data-maintenance/diff/${result.task_id}`)}>
                {t('importPage.viewDiffPreview')}
              </Button>
            )}
            <Button onClick={() => { setResult(null); setFile(null); setActiveTab('all'); }}>{t('importPage.reUpload')}</Button>
            <Button onClick={() => navigate(`/data-maintenance/browse/${tableConfigId}`)}>{t('importPage.backToBrowse')}</Button>
          </Space>
        </Card>
      </div>
    );
  }

  return (
    <Card
      title={
        <Space>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate(`/data-maintenance/browse/${tableConfigId}`)} />
          <span>{t('importPage.title')}</span>
        </Space>
      }
    >
      <Dragger
        accept=".xlsx,.xls"
        maxCount={1}
        beforeUpload={(f) => {
          setFile(f);
          return false;
        }}
        onRemove={() => setFile(null)}
        fileList={file ? [{ uid: '-1', name: file.name, status: 'done' }] : []}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{t('importPage.uploadHint')}</p>
        <p className="ant-upload-hint">{t('importPage.uploadSubHint')}</p>
      </Dragger>

      {file && (
        <Descriptions style={{ marginTop: 16 }} column={2} size="small" bordered>
          <Descriptions.Item label={t('importPage.fileName')}>{file.name}</Descriptions.Item>
          <Descriptions.Item label={t('importPage.fileSize')}>{(file.size / 1024).toFixed(1)} KB</Descriptions.Item>
        </Descriptions>
      )}

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Space>
          <Button onClick={() => navigate(`/data-maintenance/browse/${tableConfigId}`)}>{t('common.back')}</Button>
          <Button type="primary" onClick={handleUpload} loading={uploading} disabled={!file}>
            {t('importPage.startValidation')}
          </Button>
        </Space>
      </div>
    </Card>
  );
}
