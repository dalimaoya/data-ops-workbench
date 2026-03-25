import { useState, useEffect } from 'react';
import {
  Card, Table, Tag, Button, Space, Tabs, Modal, Input, message, Descriptions, Switch, Tooltip,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, SettingOutlined,
} from '@ant-design/icons';
import {
  listApprovals, getApprovalDetail, approveRequest, rejectRequest,
  getApprovalEnabled, setApprovalEnabled,
} from '../../api/approvals';
import type { ApprovalItem, ApprovalDetail } from '../../api/approvals';
import { formatBeijingTime } from '../../utils/formatTime';
import { useTranslation } from 'react-i18next';

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
};

export default function ApprovalCenter() {
  const { t } = useTranslation();

  const requestTypeLabels: Record<string, string> = {
    writeback: t('approval.requestTypeWriteback'),
    delete: t('approval.requestTypeDelete'),
    batch_insert: t('approval.requestTypeBatchInsert'),
    inline_update: t('approval.requestTypeInlineUpdate'),
    inline_insert: t('approval.requestTypeInlineInsert'),
  };

  const statusLabels: Record<string, string> = {
    pending: t('approval.pending'),
    approved: t('approval.approved'),
    rejected: t('approval.rejected'),
  };

  const [activeTab, setActiveTab] = useState('pending');
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [, setDetailLoading] = useState(false);

  // Reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  // Approval enabled switch
  const [approvalEnabled, setApprovalEnabledState] = useState(false);
  const [switchLoading, setSwitchLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listApprovals({ status: activeTab, page, page_size: pageSize });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch {
      message.error(t('approval.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchSwitch = async () => {
    try {
      const res = await getApprovalEnabled();
      setApprovalEnabledState(res.data.approval_enabled);
    } catch {
      // ignore
    }
  };

  useEffect(() => { fetchData(); }, [activeTab, page]);
  useEffect(() => { fetchSwitch(); }, []);

  const handleApprove = async (id: number) => {
    Modal.confirm({
      title: t('approval.approveConfirmTitle'),
      content: t('approval.approveConfirmContent'),
      onOk: async () => {
        try {
          await approveRequest(id);
          message.success(t('approval.approveSuccess'));
          fetchData();
        } catch (err: any) {
          message.error(err?.response?.data?.detail || t('approval.approveFailed'));
        }
      },
    });
  };

  const handleRejectConfirm = async () => {
    if (rejectId === null) return;
    setRejectLoading(true);
    try {
      await rejectRequest(rejectId, rejectReason);
      message.success(t('approval.rejectSuccess'));
      setRejectOpen(false);
      setRejectReason('');
      setRejectId(null);
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('common.failed'));
    } finally {
      setRejectLoading(false);
    }
  };

  const handleViewDetail = async (id: number) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await getApprovalDetail(id);
      setDetail(res.data);
    } catch {
      message.error(t('approval.detailLoadFailed'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSwitchChange = async (checked: boolean) => {
    setSwitchLoading(true);
    try {
      await setApprovalEnabled(checked);
      setApprovalEnabledState(checked);
      message.success(checked ? t('approval.approvalEnabledSuccess') : t('approval.approvalDisabledSuccess'));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('common.failed'));
    } finally {
      setSwitchLoading(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: t('approval.requestType'), dataIndex: 'request_type', key: 'request_type', width: 100,
      render: (v: string) => <Tag>{requestTypeLabels[v] || v}</Tag>,
    },
    { title: t('common.tableName'), dataIndex: 'table_alias', key: 'table_alias', width: 150,
      render: (v: string, r: ApprovalItem) => v || r.table_name,
    },
    { title: t('common.datasource'), dataIndex: 'datasource_name', key: 'datasource_name', width: 120 },
    { title: t('approval.applicant'), dataIndex: 'requested_by', key: 'requested_by', width: 100 },
    {
      title: t('approval.applyTime'), dataIndex: 'request_time', key: 'request_time', width: 170,
      render: (v: string) => formatBeijingTime(v),
    },
    {
      title: t('common.status'), dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => <Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>,
    },
    ...(activeTab === 'approved' || activeTab === 'rejected' ? [
      { title: t('approval.approver'), dataIndex: 'approved_by', key: 'approved_by', width: 100 },
      {
        title: t('approval.approveTime'), dataIndex: 'approve_time', key: 'approve_time', width: 170,
        render: (v: string) => formatBeijingTime(v),
      },
    ] : []),
    ...(activeTab === 'rejected' ? [
      { title: t('approval.rejectReason'), dataIndex: 'reject_reason', key: 'reject_reason', width: 200 },
    ] : []),
    {
      title: t('common.operation'), key: 'action', width: activeTab === 'pending' ? 220 : 80,
      render: (_: unknown, record: ApprovalItem) => (
        <Space size="small">
          <Tooltip title={t('common.detail')}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>
              {t('common.detail')}
            </Button>
          </Tooltip>
          {activeTab === 'pending' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => handleApprove(record.id)}
              >
                {t('approval.approve')}
              </Button>
              <Button
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => { setRejectId(record.id); setRejectOpen(true); }}
              >
                {t('approval.reject')}
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={t('approval.title')}
        extra={
          <Space>
            <SettingOutlined />
            <span>{t('approval.approvalFlow')}</span>
            <Switch
              checked={approvalEnabled}
              loading={switchLoading}
              onChange={handleSwitchChange}
              checkedChildren={t('common.enable')}
              unCheckedChildren={t('common.close')}
            />
          </Space>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => { setActiveTab(k); setPage(1); }}
          items={[
            { key: 'pending', label: t('approval.pending') },
            { key: 'approved', label: t('approval.approved') },
            { key: 'rejected', label: t('approval.rejected') },
          ]}
        />
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showTotal: (total) => t('common.total', { count: total }),
          }}
          size="middle"
        />
      </Card>

      {/* Detail modal */}
      <Modal
        title={`${t('approval.detailTitle')} #${detail?.id || ''}`}
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setDetail(null); }}
        footer={null}
        width={700}
      >
        {detail && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label={t('approval.requestType')}>{requestTypeLabels[detail.request_type] || detail.request_type}</Descriptions.Item>
            <Descriptions.Item label={t('common.status')}>
              <Tag color={statusColors[detail.status]}>{statusLabels[detail.status] || detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('common.tableName')}>{detail.table_alias || detail.table_name}</Descriptions.Item>
            <Descriptions.Item label={t('common.datasource')}>{detail.datasource_name}</Descriptions.Item>
            <Descriptions.Item label={t('approval.applicant')}>{detail.requested_by}</Descriptions.Item>
            <Descriptions.Item label={t('approval.applyTime')}>{formatBeijingTime(detail.request_time)}</Descriptions.Item>
            {detail.approved_by && (
              <>
                <Descriptions.Item label={t('approval.approver')}>{detail.approved_by}</Descriptions.Item>
                <Descriptions.Item label={t('approval.approveTime')}>{formatBeijingTime(detail.approve_time)}</Descriptions.Item>
              </>
            )}
            {detail.reject_reason && (
              <Descriptions.Item label={t('approval.rejectReason')} span={2}>{detail.reject_reason}</Descriptions.Item>
            )}
            {detail.diff_preview && detail.diff_preview.diff_rows && detail.diff_preview.diff_rows.length > 0 && (
              <Descriptions.Item label={t('approval.diffPreview')} span={2}>
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={detail.diff_preview.diff_rows.map((r: any, i: number) => ({ ...r, _key: i }))}
                    rowKey="_key"
                    columns={[
                      { title: t('diffPreview.pkValue'), dataIndex: 'pk_key', width: 100 },
                      { title: t('diffPreview.fieldName'), dataIndex: 'field_alias', width: 100 },
                      {
                        title: t('diffPreview.oldValue'), dataIndex: 'old_value', width: 120,
                        render: (v: string) => <span style={{ color: '#999' }}>{v ?? '-'}</span>,
                      },
                      {
                        title: t('diffPreview.newValue'), dataIndex: 'new_value', width: 120,
                        render: (v: string) => <span style={{ color: '#1890ff', fontWeight: 500 }}>{v ?? '-'}</span>,
                      },
                      {
                        title: t('diffPreview.changeType'), dataIndex: 'change_type', width: 80,
                        render: (v: string) => (
                          <Tag color={v === 'insert' ? 'green' : v === 'update' ? 'blue' : 'default'}>{v}</Tag>
                        ),
                      },
                    ]}
                  />
                </div>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal
        title={t('approval.rejectTitle')}
        open={rejectOpen}
        onOk={handleRejectConfirm}
        onCancel={() => { setRejectOpen(false); setRejectReason(''); setRejectId(null); }}
        confirmLoading={rejectLoading}
        destroyOnClose
      >
        <Input.TextArea
          placeholder={t('approval.rejectReasonPlaceholder')}
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
