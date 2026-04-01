import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Space, Button, Input, Select, DatePicker, Modal, Tag,
  Descriptions, message, Typography, Row, Col,
} from 'antd';
import { ExclamationCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  listBackupVersions,
  getBackupVersionDetail,
  rollbackVersion,
  type BackupVersion,
  type BackupVersionDetail,
} from '../../api/backupVersion';
import { listDatasources } from '../../api/datasource';
import { formatBeijingTime } from '../../utils/formatTime';
import { useTranslation } from 'react-i18next';

const { RangePicker } = DatePicker;
const { Text } = Typography;

export default function VersionRollback() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BackupVersion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [datasourceId, setDatasourceId] = useState<number | undefined>();
  const [tableName, setTableName] = useState('');
  const [operatorUser, setOperatorUser] = useState('');
  const [timeRange, setTimeRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

  // Datasource options
  const [dsOptions, setDsOptions] = useState<{ value: number; label: string }[]>([]);

  // Detail modal
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<BackupVersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Rollback modal
  const [rollbackTarget, setRollbackTarget] = useState<BackupVersion | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  useEffect(() => {
    listDatasources().then(res => {
      const list = Array.isArray(res.data) ? res.data : [];
      setDsOptions(list.map((d: any) => ({ value: d.id, label: d.datasource_name })));
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (datasourceId) params.datasource_id = datasourceId;
      if (tableName) params.table_name = tableName;
      if (operatorUser) params.operator_user = operatorUser;
      if (timeRange) {
        params.start_time = timeRange[0].format('YYYY-MM-DDTHH:mm:ss');
        params.end_time = timeRange[1].format('YYYY-MM-DDTHH:mm:ss');
      }
      const res = await listBackupVersions(params);
      setData(res.data.items);
      setTotal(res.data.total);
    } catch {
      message.error(t('versionRollback.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, datasourceId, tableName, operatorUser, timeRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleViewDetail = async (record: BackupVersion) => {
    setDetailLoading(true);
    setDetailVisible(true);
    try {
      const res = await getBackupVersionDetail(record.id);
      setDetail(res.data);
    } catch {
      message.error(t('versionRollback.detailLoadFailed'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRollback = (record: BackupVersion) => {
    setRollbackTarget(record);
  };

  const confirmRollback = async () => {
    if (!rollbackTarget) return;
    setRollbackLoading(true);
    try {
      const res = await rollbackVersion(rollbackTarget.id);
      message.success(res.data.message || t('versionRollback.rollbackSuccess'));
      setRollbackTarget(null);
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('versionRollback.rollbackFailed'));
    } finally {
      setRollbackLoading(false);
    }
  };

  const columns: ColumnsType<BackupVersion> = [
    { title: t('versionRollback.versionNo'), dataIndex: 'backup_version_no', width: 200 },
    { title: t('common.datasource'), dataIndex: 'datasource_name', width: 150 },
    { title: t('common.tableName'), dataIndex: 'table_name', width: 150,
      render: (v, r) => r.table_alias ? `${r.table_alias}（${v}）` : v },
    { title: t('versionRollback.backupTime'), dataIndex: 'backup_time', width: 180, render: (v: string) => formatBeijingTime(v) },
    { title: t('versionRollback.triggerType'), dataIndex: 'trigger_type', width: 140,
      render: v => {
        const map: Record<string, string> = {
          'triggered_by_writeback': t('versionRollback.triggerWriteback'),
          'triggered_by_rollback': t('versionRollback.triggerRollback'),
        };
        return map[v] || v;
      },
    },
    { title: t('versionRollback.relatedBatch'), dataIndex: 'related_writeback_batch_no', width: 200 },
    { title: t('common.operator'), dataIndex: 'operator_user', width: 100 },
    { title: t('versionRollback.recordCount'), dataIndex: 'record_count', width: 100 },
    {
      title: t('versionRollback.canRollback'), dataIndex: 'can_rollback', width: 80,
      render: v => v ? <Tag color="green">{t('common.yes')}</Tag> : <Tag color="default">{t('common.no')}</Tag>,
    },
    {
      title: t('common.operation'), fixed: 'right', width: 160,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
            {t('common.detail')}
          </Button>
          <Button
            type="link" size="small"
            disabled={!record.can_rollback || record.storage_status !== 'valid'}
            onClick={() => handleRollback(record)}
            icon={<RollbackOutlined />}
          >
            {t('versionRollback.rollback')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card title={t('versionRollback.title')} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]}>
          <Col>
            <Select
              placeholder={t('common.datasource')} allowClear style={{ width: 180 }}
              options={dsOptions}
              value={datasourceId}
              onChange={v => { setDatasourceId(v); setPage(1); }}
            />
          </Col>
          <Col>
            <Input placeholder={t('common.tableName')} allowClear style={{ width: 160 }}
              value={tableName}
              onChange={e => { setTableName(e.target.value); setPage(1); }}
            />
          </Col>
          <Col>
            <Input placeholder={t('common.operator')} allowClear style={{ width: 120 }}
              value={operatorUser}
              onChange={e => { setOperatorUser(e.target.value); setPage(1); }}
            />
          </Col>
          <Col>
            <RangePicker showTime
              value={timeRange}
              onChange={v => { setTimeRange(v as any); setPage(1); }}
            />
          </Col>
          <Col>
            <Button type="primary" onClick={() => { setPage(1); fetchData(); }}>{t('common.search')}</Button>
          </Col>
          <Col>
            <Button onClick={() => {
              setDatasourceId(undefined); setTableName(''); setOperatorUser(''); setTimeRange(null); setPage(1);
            }}>{t('common.reset')}</Button>
          </Col>
        </Row>
      </Card>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{
            current: page, pageSize, total,
            showSizeChanger: true, pageSizeOptions: ['20', '50', '100'],
            showTotal: (total) => t('common.total', { count: total }),
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </Card>

      {/* Detail Modal */}
      <Modal
        title={t('versionRollback.detailTitle')} open={detailVisible} width={700}
        onCancel={() => setDetailVisible(false)} footer={null}
        loading={detailLoading}
      >
        {detail && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label={t('versionRollback.versionNo')}>{detail.backup_version_no}</Descriptions.Item>
            <Descriptions.Item label={t('common.datasource')}>{detail.datasource_name}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.originalTable')}>{detail.table_name}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.backupTableName')}>{detail.backup_table_name}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.recordCount')}>{detail.record_count}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.storageStatus')}>
              <Tag color={detail.storage_status === 'valid' ? 'green' : 'red'}>
                {detail.storage_status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.triggerType')}>{detail.trigger_type}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.relatedBatch')}>{detail.related_writeback_batch_no || '-'}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.backupStarted')}>{formatBeijingTime(detail.backup_started_at)}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.backupFinished')}>{formatBeijingTime(detail.backup_finished_at)}</Descriptions.Item>
            <Descriptions.Item label={t('common.operator')}>{detail.operator_user}</Descriptions.Item>
            <Descriptions.Item label={t('versionRollback.createdAt')}>{formatBeijingTime(detail.created_at)}</Descriptions.Item>
            {detail.remark && (
              <Descriptions.Item label={t('common.remark')} span={2}>{detail.remark}</Descriptions.Item>
            )}
            {detail.writeback_info && (
              <>
                <Descriptions.Item label={t('versionRollback.writebackBatch')} span={2}>
                  {detail.writeback_info.writeback_batch_no}
                  {' — '}
                  {t('versionRollback.writebackSuccess')} {detail.writeback_info.success_row_count} / {t('versionRollback.writebackFailed')} {detail.writeback_info.failed_row_count}
                  {' — '}
                  <Tag color={detail.writeback_info.writeback_status === 'success' ? 'green' : 'red'}>
                    {detail.writeback_info.writeback_status}
                  </Tag>
                </Descriptions.Item>
              </>
            )}
          </Descriptions>
        )}
      </Modal>

      {/* Rollback Confirmation Modal */}
      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#faad14' }} />
            <span>{t('versionRollback.confirmRollback')}</span>
          </Space>
        }
        open={!!rollbackTarget}
        onCancel={() => setRollbackTarget(null)}
        onOk={confirmRollback}
        confirmLoading={rollbackLoading}
        okText={t('versionRollback.confirmRollback')}
        okButtonProps={{ danger: true }}
      >
        {rollbackTarget && (
          <>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('versionRollback.targetTable')}>{rollbackTarget.table_alias || rollbackTarget.table_name}</Descriptions.Item>
              <Descriptions.Item label={t('versionRollback.versionNo')}>{rollbackTarget.backup_version_no}</Descriptions.Item>
              <Descriptions.Item label={t('versionRollback.backupTime')}>{formatBeijingTime(rollbackTarget.backup_time)}</Descriptions.Item>
              <Descriptions.Item label={t('versionRollback.backupRecordCount')}>{t('versionRollback.records', { count: rollbackTarget.record_count })}</Descriptions.Item>
            </Descriptions>
            <div style={{
              padding: '12px 16px', background: '#fff7e6', border: '1px solid #ffd591',
              borderRadius: 6, marginTop: 8,
            }}>
              <Text type="warning" strong>{t('versionRollback.riskWarning')}</Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                <li>{t('versionRollback.riskTip1')}</li>
                <li>{t('versionRollback.riskTip2')}</li>
                <li>{t('versionRollback.riskTip3')}</li>
              </ul>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
