import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Space, Button, Descriptions, message, Modal, Result, Dropdown } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, DownloadOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { getImportDiff, executeWriteback, downloadCompareReport } from '../../api/dataMaintenance';
import type { DiffResponse, WritebackResult } from '../../api/dataMaintenance';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from 'react-i18next';
import ImpactAssessPanel from './ImpactAssessPanel';

export default function DiffPreview() {
  const { t } = useTranslation();
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWriteback = user?.role === 'admin' || user?.role === 'operator';
  const tid = Number(taskId);

  const [loading, setLoading] = useState(false);
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [writingBack, setWritingBack] = useState(false);
  const [writeResult, setWriteResult] = useState<WritebackResult | null>(null);

  useEffect(() => {
    setLoading(true);
    getImportDiff(tid)
      .then(res => setDiffData(res.data))
      .catch(() => message.error(t('diffPreview.diffFetchFailed')))
      .finally(() => setLoading(false));
  }, [tid]);

  const handleWriteback = () => {
    Modal.confirm({
      title: t('diffPreview.confirmWritebackTitle'),
      content: t('diffPreview.confirmWritebackContent'),
      okText: t('diffPreview.confirmWriteback'),
      okType: 'primary',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setWritingBack(true);
        try {
          const res = await executeWriteback(tid);
          setWriteResult(res.data);
          message.success(t('diffPreview.writebackComplete'));
        } catch (e: unknown) {
          const err = e as { response?: { data?: { detail?: string } } };
          message.error(err?.response?.data?.detail || t('diffPreview.writebackFailed'));
        } finally {
          setWritingBack(false);
        }
      },
    });
  };

  // Write result view
  if (writeResult) {
    const resultStatus = writeResult.status === 'success' ? 'success' : writeResult.status === 'failed' ? 'error' : 'warning';
    const resultTitle = writeResult.status === 'success'
      ? t('diffPreview.writebackSuccess')
      : writeResult.status === 'failed'
        ? t('diffPreview.writebackFailedResult')
        : t('diffPreview.writebackPartial');

    return (
      <Card>
        <Result
          status={resultStatus}
          title={resultTitle}
          subTitle={t('diffPreview.writebackSummary', { updated: writeResult.updated, inserted: writeResult.inserted, failed: writeResult.failed })}
          extra={[
            <Button key="back" onClick={() => navigate(`/data-maintenance/browse/${diffData?.table_config_id}`)}>
              {t('diffPreview.backToBrowse')}
            </Button>,
            <Button key="home" type="primary" onClick={() => navigate('/data-maintenance')}>
              {t('diffPreview.backToMaintenance')}
            </Button>,
          ]}
        >
          <Descriptions column={2} bordered size="small" style={{ marginTop: 16 }}>
            <Descriptions.Item label={t('diffPreview.writebackBatchNo')}>{writeResult.writeback_batch_no}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.backupVersionNo')}>{writeResult.backup_version_no}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.backupTableName')}>{writeResult.backup_table}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.backupRecordCount')}>{writeResult.backup_record_count}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.updatedRows')}>{writeResult.updated}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.insertedRows')}>{writeResult.inserted}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.operatorUser')}>{writeResult.operator_user}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.finishedTime')}>{writeResult.finished_at}</Descriptions.Item>
          </Descriptions>

          {writeResult.failed_details && writeResult.failed_details.length > 0 && (
            <Card title={t('diffPreview.failedDetails')} size="small" style={{ marginTop: 16 }}>
              {writeResult.failed_details.map((d, i) => (
                <div key={i} style={{ color: '#ff4d4f', fontSize: 13 }}>
                  {t('diffPreview.rowNum')}{d.row_num} (PK: {d.pk_key}): {d.error}
                </div>
              ))}
            </Card>
          )}
        </Result>
      </Card>
    );
  }

  const diffColumns = [
    { title: t('diffPreview.rowNum'), dataIndex: 'row_num', key: 'row_num', width: 70 },
    { title: t('diffPreview.pkValue'), dataIndex: 'pk_key', key: 'pk_key', width: 150 },
    { title: t('diffPreview.fieldName'), dataIndex: 'field_alias', key: 'field_alias', width: 150 },
    {
      title: t('diffPreview.oldValue'),
      dataIndex: 'old_value',
      key: 'old_value',
      render: (v: string | null, record: { change_type?: string }) =>
        record.change_type === 'insert'
          ? <span style={{ color: '#999', fontStyle: 'italic' }}>—</span>
          : <span style={{ color: '#999' }}>{v ?? 'NULL'}</span>,
    },
    {
      title: t('diffPreview.newValue'),
      dataIndex: 'new_value',
      key: 'new_value',
      render: (v: string | null, record: { change_type?: string }) =>
        <span style={{ color: record.change_type === 'insert' ? '#52c41a' : '#1890ff', fontWeight: 500 }}>{v ?? 'NULL'}</span>,
    },
    {
      title: t('diffPreview.changeType'),
      dataIndex: 'change_type',
      key: 'change_type',
      width: 80,
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          update: { color: 'orange', label: t('diffPreview.changeUpdate') },
          insert: { color: 'green', label: t('diffPreview.changeInsert') },
        };
        const info = map[v] || { color: 'default', label: v };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
  ];

  // Count update vs insert diff rows
  const updateDiffCount = diffData?.diff_rows?.filter(d => d.change_type === 'update').length ?? 0;
  const insertDiffCount = diffData?.diff_rows?.filter(d => d.change_type === 'insert').length ?? 0;
  void insertDiffCount;

  return (
    <div>
      <Card
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate(-1)} />
            <span>{t('diffPreview.title')}</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {diffData && (
          <Descriptions column={4} size="small">
            <Descriptions.Item label={t('common.tableName')}>{diffData.table_alias || diffData.table_name}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.batchNo')}>{diffData.import_batch_no}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.configVersion')}>v{diffData.config_version}</Descriptions.Item>
            <Descriptions.Item label={t('diffPreview.importer')}>{diffData.operator_user}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      {/* Summary cards */}
      {diffData && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold' }}>{diffData.passed_rows}</div>
            <div style={{ color: '#666' }}>{t('diffPreview.operationRecords')}</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1890ff' }}>{updateDiffCount}</div>
            <div style={{ color: '#666' }}>{t('diffPreview.updateDiffs')}</div>
          </Card>
          {(diffData.new_count ?? 0) > 0 && (
            <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>{diffData.new_count}</div>
              <div style={{ color: '#666' }}>{t('diffPreview.newRows')}</div>
            </Card>
          )}
          <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>{diffData.failed_rows}</div>
            <div style={{ color: '#666' }}>{t('diffPreview.failedRecords')}</div>
          </Card>
        </div>
      )}

      <Card>
        <Table
          rowKey={(_r, i) => String(i)}
          columns={diffColumns}
          dataSource={diffData?.diff_rows || []}
          loading={loading}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 50, showTotal: (total) => t('diffPreview.totalDiff', { count: total }) }}
          size="small"
          rowClassName={(record) => record.change_type === 'insert' ? 'ant-table-row-insert' : ''}
        />

        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Space>
            {diffData && diffData.diff_rows && diffData.diff_rows.length > 0 && (
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'excel',
                      icon: <FileExcelOutlined />,
                      label: t('diffPreview.formatExcel'),
                      onClick: async () => {
                        try {
                          const res = await downloadCompareReport(diffData.table_config_id, tid, 'excel');
                          const url = window.URL.createObjectURL(new Blob([res.data]));
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `compare_report_${tid}.xlsx`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                          message.success(t('diffPreview.reportDownloaded'));
                        } catch {
                          message.error(t('diffPreview.reportFailed'));
                        }
                      },
                    },
                    {
                      key: 'pdf',
                      icon: <FilePdfOutlined />,
                      label: t('diffPreview.formatPdf'),
                      onClick: async () => {
                        try {
                          const res = await downloadCompareReport(diffData.table_config_id, tid, 'pdf');
                          const url = window.URL.createObjectURL(new Blob([res.data]));
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `compare_report_${tid}.pdf`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                          message.success(t('diffPreview.reportDownloaded'));
                        } catch {
                          message.error(t('diffPreview.reportFailed'));
                        }
                      },
                    },
                  ],
                }}
              >
                <Button icon={<DownloadOutlined />}>
                  {t('diffPreview.exportCompareReport')}
                </Button>
              </Dropdown>
            )}
            <Button onClick={() => navigate(-1)}>{t('diffPreview.backToValidation')}</Button>
            <Button onClick={() => navigate(`/data-maintenance/browse/${diffData?.table_config_id}`)}>{t('diffPreview.cancelOperation')}</Button>
            {canWriteback && (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={writingBack}
                disabled={!diffData || diffData.failed_rows > 0}
                onClick={handleWriteback}
              >
                {t('diffPreview.confirmWriteback')}
              </Button>
            )}
            {diffData && diffData.failed_rows > 0 && (
              <span style={{ color: '#ff4d4f', fontSize: 12 }}>{t('diffPreview.hasFailedRows')}</span>
            )}
            {canWriteback && diffData && diffData.diff_rows && diffData.diff_rows.length > 0 && (
              <ImpactAssessPanel
                tableId={diffData.table_config_id}
                changes={diffData.diff_rows.map((r: any) => ({
                  row_pk: r.pk_key,
                  field_name: r.field_alias || r.field_name,
                  old_value: r.old_value,
                  new_value: r.new_value,
                  change_type: r.change_type,
                }))}
              />
            )}
          </Space>
        </div>
      </Card>

      {/* Style for insert rows */}
      <style>{`
        .ant-table-row-insert td {
          background-color: #f6ffed !important;
        }
      `}</style>
    </div>
  );
}
