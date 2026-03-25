import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Checkbox, Progress, Space, Table, Tag, Upload, Radio,
  Modal, Alert, Descriptions, Typography, message, Popconfirm, Divider, Result,
} from 'antd';
import {
  CloudDownloadOutlined, CloudUploadOutlined, DeleteOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  DatabaseOutlined, SafetyOutlined, HistoryOutlined, DownloadOutlined,
} from '@ant-design/icons';
import type { UploadFile as _UploadFile } from 'antd/es/upload/interface';
import { useTranslation } from 'react-i18next';
import {
  createBackup, getBackupHistory, deleteBackup, uploadBackup,
  restorePlatform, downloadBackupUrl,
  type BackupHistoryItem, type ManifestInfo as _ManifestInfo, type UploadResult,
} from '../../api/platformBackup';

// Re-export to suppress unused warnings (types used indirectly)
type _Suppress = _UploadFile | _ManifestInfo;
void (0 as unknown as _Suppress);

const { Text, Title } = Typography;

export default function PlatformBackup() {
  const { t } = useTranslation();

  // ── Backup state ──
  const [includeLogs, setIncludeLogs] = useState(false);
  const [includeBackups, setIncludeBackups] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupResult, setBackupResult] = useState<{
    filename: string;
    download_url: string;
    file_size_human: string;
  } | null>(null);

  // ── History state ──
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Upload / Restore state ──
  const [uploadedInfo, setUploadedInfo] = useState<UploadResult | null>(null);
  const [restoreMode, setRestoreMode] = useState<'overwrite' | 'merge'>('overwrite');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await getBackupHistory();
      setHistory(res.data.data);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ── Handlers ──

  const handleBackup = async () => {
    setBackupLoading(true);
    setBackupProgress(10);
    setBackupResult(null);
    try {
      // Simulate progress
      const timer = setInterval(() => {
        setBackupProgress((prev) => Math.min(prev + 15, 85));
      }, 400);

      const res = await createBackup({
        include_logs: includeLogs,
        include_backups: includeBackups,
        format: 'zip',
      });

      clearInterval(timer);
      setBackupProgress(100);

      const d = res.data.data;
      setBackupResult({
        filename: d.filename,
        download_url: d.download_url,
        file_size_human: d.file_size_human,
      });
      message.success(t('platformBackup.backupSuccess'));
      fetchHistory();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('platformBackup.backupFailed'));
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await deleteBackup(filename);
      message.success(t('common.success'));
      fetchHistory();
    } catch {
      message.error(t('common.failed'));
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadedInfo(null);
    setRestoreSuccess(false);
    try {
      const res = await uploadBackup(file);
      setUploadedInfo(res.data.data);
      message.success(t('platformBackup.uploadSuccess'));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('platformBackup.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleRestore = () => {
    if (!uploadedInfo) return;
    Modal.confirm({
      title: t('platformBackup.confirmRestoreTitle'),
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>{t('platformBackup.confirmRestoreDesc')}</p>
          <p style={{ color: '#faad14' }}>{t('platformBackup.autoBackupHint')}</p>
        </div>
      ),
      okText: t('platformBackup.confirmRestore'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setRestoreLoading(true);
        try {
          await restorePlatform({
            backup_file: uploadedInfo.filename,
            mode: restoreMode,
            confirm: true,
          });
          setRestoreSuccess(true);
          message.success(t('platformBackup.restoreSuccess'));
          message.warning(t('platformBackup.restoreSensitiveHint'), 8);
        } catch (err: any) {
          message.error(err?.response?.data?.detail || t('platformBackup.restoreFailed'));
        } finally {
          setRestoreLoading(false);
        }
      },
    });
  };

  const handleDownload = (filename: string) => {
    const token = localStorage.getItem('token');
    const url = downloadBackupUrl(filename);
    // Use fetch with auth header for download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => message.error(t('common.failed')));
  };

  // ── Columns ──

  const historyColumns = [
    {
      title: t('platformBackup.backupTime'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
    },
    {
      title: t('platformBackup.fileSize'),
      dataIndex: 'file_size_human',
      key: 'file_size_human',
      width: 100,
    },
    {
      title: t('platformBackup.contents'),
      dataIndex: 'contents',
      key: 'contents',
      render: (val: string) => {
        const parts = val ? val.split('+') : [];
        return (
          <Space size={4} wrap>
            {parts.map((p) => (
              <Tag key={p} color="blue">{p}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 180,
      render: (_: unknown, record: BackupHistoryItem) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(record.filename)}
          >
            {t('common.download')}
          </Button>
          <Popconfirm
            title={t('common.confirmDelete')}
            onConfirm={() => handleDelete(record.filename)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ──

  return (
    <Card
      title={
        <Space>
          <SafetyOutlined />
          <span>{t('platformBackup.title')}</span>
        </Space>
      }
      style={{ margin: 0 }}
      styles={{ body: { padding: '16px 24px' } }}
    >
      {/* ── Backup Section ── */}
      <Title level={5}>
        <DatabaseOutlined style={{ marginRight: 8 }} />
        {t('platformBackup.createBackup')}
      </Title>

      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('platformBackup.backupContents')}:</div>
        <Space direction="vertical">
          <Checkbox checked disabled>
            {t('platformBackup.platformConfig')} <Tag color="red">{t('platformBackup.required')}</Tag>
          </Checkbox>
          <Checkbox checked disabled>
            {t('platformBackup.usersAndPermissions')}
          </Checkbox>
          <Checkbox checked disabled>
            {t('platformBackup.systemSettings')}
          </Checkbox>
          <Checkbox checked={includeLogs} onChange={(e) => setIncludeLogs(e.target.checked)}>
            {t('platformBackup.operationLogs')}
          </Checkbox>
          <Checkbox checked={includeBackups} onChange={(e) => setIncludeBackups(e.target.checked)}>
            {t('platformBackup.historyBackups')}
          </Checkbox>
        </Space>
      </div>

      <Button
        type="primary"
        icon={<CloudDownloadOutlined />}
        loading={backupLoading}
        onClick={handleBackup}
        size="large"
      >
        {t('platformBackup.startBackup')}
      </Button>

      {backupLoading && (
        <Progress
          percent={backupProgress}
          status="active"
          style={{ marginTop: 16, maxWidth: 400 }}
        />
      )}

      {backupResult && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginTop: 16 }}
          message={
            <Space>
              <span>
                {t('platformBackup.backupComplete')} {t('platformBackup.fileSize')}: {backupResult.file_size_human}
              </span>
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => handleDownload(backupResult.filename)}
              >
                {t('platformBackup.downloadBackup')}
              </Button>
            </Space>
          }
        />
      )}

      {/* ── History Section ── */}
      <Divider />
      <Title level={5}>
        <HistoryOutlined style={{ marginRight: 8 }} />
        {t('platformBackup.historyTitle')}
      </Title>

      <Table
        dataSource={history}
        columns={historyColumns}
        rowKey="filename"
        loading={historyLoading}
        pagination={false}
        size="middle"
        locale={{ emptyText: t('common.noData') }}
      />

      {/* ── Restore Section ── */}
      <Divider />
      <Title level={5}>
        <CloudUploadOutlined style={{ marginRight: 8 }} />
        {t('platformBackup.importRestore')}
      </Title>

      <Alert
        type="warning"
        showIcon
        message={t('platformBackup.importWarning')}
        style={{ marginBottom: 16 }}
      />

      <Upload.Dragger
        accept=".zip"
        maxCount={1}
        showUploadList={false}
        customRequest={({ file }) => handleUpload(file as File)}
        disabled={uploading}
      >
        <p className="ant-upload-drag-icon">
          <CloudUploadOutlined style={{ fontSize: 48, color: '#1890ff' }} />
        </p>
        <p className="ant-upload-text">{t('platformBackup.uploadHint')}</p>
        <p className="ant-upload-hint">{t('platformBackup.uploadDesc')}</p>
      </Upload.Dragger>

      {uploading && <Progress percent={50} status="active" style={{ marginTop: 16 }} />}

      {uploadedInfo && (
        <div style={{ marginTop: 24 }}>
          <Divider />
          <Title level={5}>{t('platformBackup.backupInfo')}</Title>
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label={t('platformBackup.fileName')}>
              {uploadedInfo.filename}
            </Descriptions.Item>
            <Descriptions.Item label={t('platformBackup.fileSize')}>
              {uploadedInfo.file_size_human}
            </Descriptions.Item>
            <Descriptions.Item label={t('platformBackup.backupTime')}>
              {uploadedInfo.manifest.created_at}
            </Descriptions.Item>
            <Descriptions.Item label={t('platformBackup.sourceVersion')}>
              v{uploadedInfo.manifest.app_version}
            </Descriptions.Item>
            <Descriptions.Item label={t('platformBackup.contents')}>
              <Space direction="vertical" size={4}>
                {uploadedInfo.manifest.contents.platform_config ? (
                  <Text>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    {t('platformBackup.platformConfig')} — {uploadedInfo.manifest.stats.datasources}{' '}
                    {t('platformBackup.datasources')}, {uploadedInfo.manifest.stats.tables}{' '}
                    {t('platformBackup.tables')}
                  </Text>
                ) : (
                  <Text type="secondary">
                    <CloseCircleOutlined style={{ marginRight: 4 }} />
                    {t('platformBackup.platformConfig')}
                  </Text>
                )}
                {uploadedInfo.manifest.contents.users ? (
                  <Text>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    {t('platformBackup.usersAndPermissions')} — {uploadedInfo.manifest.stats.users}{' '}
                    {t('platformBackup.userCount')}
                  </Text>
                ) : (
                  <Text type="secondary">
                    <CloseCircleOutlined style={{ marginRight: 4 }} />
                    {t('platformBackup.usersAndPermissions')}
                  </Text>
                )}
                {uploadedInfo.manifest.contents.settings ? (
                  <Text>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    {t('platformBackup.systemSettings')}
                  </Text>
                ) : (
                  <Text type="secondary">
                    <CloseCircleOutlined style={{ marginRight: 4 }} />
                    {t('platformBackup.systemSettings')}
                  </Text>
                )}
                {uploadedInfo.manifest.contents.logs ? (
                  <Text>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    {t('platformBackup.operationLogs')}
                  </Text>
                ) : (
                  <Text type="secondary">
                    <CloseCircleOutlined style={{ marginRight: 4 }} />
                    {t('platformBackup.operationLogs')}
                  </Text>
                )}
              </Space>
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('platformBackup.importMode')}:</div>
            <Radio.Group value={restoreMode} onChange={(e) => setRestoreMode(e.target.value)}>
              <Space direction="vertical">
                <Radio value="overwrite">{t('platformBackup.modeOverwrite')}</Radio>
                <Radio value="merge">{t('platformBackup.modeMerge')}</Radio>
              </Space>
            </Radio.Group>
          </div>

          <Space>
            <Button
              type="primary"
              danger
              icon={<CloudUploadOutlined />}
              loading={restoreLoading}
              onClick={handleRestore}
              size="large"
            >
              {t('platformBackup.confirmRestore')}
            </Button>
            <Button onClick={() => { setUploadedInfo(null); setRestoreSuccess(false); }}>
              {t('common.cancel')}
            </Button>
          </Space>
        </div>
      )}

      {restoreSuccess && (
        <Result
          status="success"
          title={t('platformBackup.restoreSuccess')}
          subTitle={t('platformBackup.reloginHint')}
          style={{ marginTop: 24 }}
          extra={
            <Button type="primary" onClick={() => { window.location.href = '/login'; }}>
              {t('platformBackup.goRelogin')}
            </Button>
          }
        />
      )}
    </Card>
  );
}
