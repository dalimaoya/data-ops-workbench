import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Modal, Input, Button, Table, Tag, Space, Alert, Statistic, Row, Col, message, Spin, Typography,
  Radio, Checkbox,
} from 'antd';
import type { RadioChangeEvent } from 'antd';
import {
  RobotOutlined, EyeOutlined, CheckCircleOutlined, EditOutlined, CloseOutlined,
  ThunderboltOutlined, GlobalOutlined, TableOutlined,
} from '@ant-design/icons';
import { batchFillPreview, batchFillApply } from '../../api/aiBatchFill';
import type { BatchFillPreviewData } from '../../api/aiBatchFill';
import { batchFillMultiPreview, multiConfirm } from '../../api/aiBatchFillMulti';
import type { MultiPreviewData, MultiConfirmResultItem } from '../../api/aiBatchFillMulti';
import MultiTableDiffNavigator from '../../components/MultiTableDiffNavigator';
import type { TableDiffData } from '../../components/MultiTableDiffNavigator';
import { api } from '../../api/request';

const { TextArea } = Input;
const { Text } = Typography;

interface ManagedTable {
  id: number;
  table_name: string;
  table_alias: string;
}

interface AIBatchFillPanelProps {
  open: boolean;
  onClose: () => void;
  tableConfigId: number;
  tableAlias?: string;
}

type ScopeType = 'single' | 'multi' | 'global';

export default function AIBatchFillPanel({ open, onClose, tableConfigId, tableAlias }: AIBatchFillPanelProps) {
  const navigate = useNavigate();
  const [ruleText, setRuleText] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewData, setPreviewData] = useState<BatchFillPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Multi-table state
  const [scope, setScope] = useState<ScopeType>('single');
  const [managedTables, setManagedTables] = useState<ManagedTable[]>([]);
  const [selectedTableIds, setSelectedTableIds] = useState<number[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [multiPreview, setMultiPreview] = useState<MultiPreviewData | null>(null);
  const [multiConfirming, setMultiConfirming] = useState(false);
  const [multiConfirmResults, setMultiConfirmResults] = useState<MultiConfirmResultItem[] | null>(null);

  // Fetch managed tables when scope changes to 'multi'
  useEffect(() => {
    if (scope === 'multi' && managedTables.length === 0) {
      setLoadingTables(true);
      api.get('/data-maintenance/tables', { params: { page: 1, page_size: 100 } })
        .then((res: { data: { items: ManagedTable[] } }) => {
          const items = res.data.items || [];
          setManagedTables(items);
          // Pre-select current table
          if (!selectedTableIds.includes(tableConfigId)) {
            setSelectedTableIds([tableConfigId]);
          }
        })
        .catch(() => message.error('获取纳管表列表失败'))
        .finally(() => setLoadingTables(false));
    }
  }, [scope]);

  const handlePreview = async () => {
    if (!ruleText.trim()) {
      message.warning('请输入修改规则');
      return;
    }

    if (scope === 'single') {
      // Single table preview (existing logic)
      setLoading(true);
      setError(null);
      setPreviewData(null);
      try {
        const res = await batchFillPreview(tableConfigId, ruleText.trim());
        setPreviewData(res.data.data);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } } };
        setError(err?.response?.data?.detail || '规则解析失败，请检查输入');
      } finally {
        setLoading(false);
      }
    } else {
      // Multi-table preview
      const ids = scope === 'global' ? [] : selectedTableIds;
      if (scope === 'multi' && ids.length === 0) {
        message.warning('请至少选择一张表');
        return;
      }

      setLoading(true);
      setError(null);
      setMultiPreview(null);
      setMultiConfirmResults(null);
      try {
        const res = await batchFillMultiPreview(
          scope === 'global' ? [] : ids,
          ruleText.trim(),
          scope,
        );
        setMultiPreview(res.data.data);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } } };
        setError(err?.response?.data?.detail || '多表规则解析失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleApply = async () => {
    if (!previewData || !previewData.changes.length) return;
    setApplying(true);
    try {
      const res = await batchFillApply(tableConfigId, previewData.changes);
      message.success(`已生成修改任务，正在跳转到差异预览...`);
      onClose();
      navigate(`/data-maintenance/diff/${res.data.task_id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || '应用修改失败');
    } finally {
      setApplying(false);
    }
  };

  const handleMultiConfirm = async (confirmedTableIds: number[]) => {
    if (!multiPreview) return;
    setMultiConfirming(true);
    try {
      const res = await multiConfirm(
        multiPreview.session_id,
        confirmedTableIds.map(id => ({ table_id: id, confirmed: true })),
      );
      setMultiConfirmResults(res.data.data.results);
      message.success('多表回写完成');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || '多表回写失败');
    } finally {
      setMultiConfirming(false);
    }
  };

  const handleReset = () => {
    setPreviewData(null);
    setMultiPreview(null);
    setMultiConfirmResults(null);
    setError(null);
  };

  const handleClose = () => {
    setRuleText('');
    setPreviewData(null);
    setMultiPreview(null);
    setMultiConfirmResults(null);
    setError(null);
    setScope('single');
    setSelectedTableIds([]);
    onClose();
  };

  const handleScopeChange = (e: RadioChangeEvent) => {
    setScope(e.target.value);
    setPreviewData(null);
    setMultiPreview(null);
    setMultiConfirmResults(null);
    setError(null);
  };

  const exampleRules = [
    '部门是华北区的，负责人改为李明',
    '所有记录的备注改为"已处理"',
    '把负责人中的张三换成李四',
    '清空所有备注字段',
    '所有金额增加10%',
  ];

  const columns = [
    {
      title: '行号',
      dataIndex: 'row_index',
      key: 'row_index',
      width: 70,
      render: (v: number) => v + 1,
    },
    {
      title: '主键',
      dataIndex: 'pk_value',
      key: 'pk_value',
      width: 120,
      ellipsis: true,
    },
    {
      title: '字段',
      dataIndex: 'field_alias',
      key: 'field_alias',
      width: 120,
    },
    {
      title: '原值',
      dataIndex: 'old_value',
      key: 'old_value',
      width: 160,
      render: (v: string | null) => (
        <span style={{ color: '#cf1322', background: '#fff1f0', padding: '1px 6px', borderRadius: 2 }}>
          {v ?? <i style={{ color: '#ccc' }}>NULL</i>}
        </span>
      ),
    },
    {
      title: '新值',
      dataIndex: 'new_value',
      key: 'new_value',
      width: 160,
      render: (v: string) => (
        <span style={{ color: '#389e0d', background: '#f6ffed', padding: '1px 6px', borderRadius: 2 }}>
          {v}
        </span>
      ),
    },
  ];

  // Determine modal width based on mode
  const modalWidth = (multiPreview && !multiConfirmResults) ? 1100 : 800;

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <span>🤖 AI 批量修改</span>
          {scope === 'single' && tableAlias && <Tag>{tableAlias}</Tag>}
          {scope === 'multi' && <Tag color="blue">多表模式</Tag>}
          {scope === 'global' && <Tag color="purple">全局模式</Tag>}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={modalWidth}
      footer={null}
      destroyOnClose
    >
      {/* ── Multi-table diff view ── */}
      {multiPreview && !previewData && (
        <MultiTableDiffNavigator
          sourceLabel="AI 批量修改"
          summary={multiPreview.summary}
          tables={multiPreview.tables as TableDiffData[]}
          onConfirm={handleMultiConfirm}
          onCancel={handleClose}
          confirming={multiConfirming}
          confirmResults={multiConfirmResults ?? undefined}
        />
      )}

      {/* ── Single-table mode or input form ── */}
      {!multiPreview && (
        <>
          {/* Scope Selection */}
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>生效范围：</Text>
            <Radio.Group value={scope} onChange={handleScopeChange}>
              <Radio value="single">
                <TableOutlined /> 单表（当前表{tableAlias ? `：${tableAlias}` : ''}）
              </Radio>
              <Radio value="multi">
                <TableOutlined /> 多表（勾选多张纳管表）
              </Radio>
              <Radio value="global">
                <GlobalOutlined /> 全局（所有纳管表）
              </Radio>
            </Radio.Group>

            {/* Multi-table selection */}
            {scope === 'multi' && (
              <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto', padding: '8px 0' }}>
                {loadingTables ? (
                  <Spin size="small" />
                ) : (
                  <>
                    <Space style={{ marginBottom: 8 }}>
                      <Button
                        size="small"
                        onClick={() => setSelectedTableIds(managedTables.map(t => t.id))}
                      >
                        全选
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                            const inverted = managedTables
                            .filter(t => !selectedTableIds.includes(t.id))
                            .map(t => t.id);
                          setSelectedTableIds(inverted);
                        }}
                      >
                        反选
                      </Button>
                      <Text type="secondary">已选 {selectedTableIds.length} 张表</Text>
                    </Space>
                    <Checkbox.Group
                      value={selectedTableIds}
                      onChange={(vals) => setSelectedTableIds(vals as number[])}
                      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    >
                      {managedTables.map(t => (
                        <Checkbox key={t.id} value={t.id}>
                          {t.table_alias || t.table_name}
                          <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                            ({t.table_name})
                          </Text>
                        </Checkbox>
                      ))}
                    </Checkbox.Group>
                  </>
                )}
              </div>
            )}

            {scope === 'global' && (
              <Alert
                type="warning"
                message="全局模式将对所有已启用的纳管表执行修改规则"
                style={{ marginTop: 8 }}
                showIcon
              />
            )}
          </div>

          {/* Rule Input */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>描述修改规则：</Text>
            <TextArea
              placeholder={'例如：把所有部门是"华北区"的记录，负责人改成"李明"'}
              value={ruleText}
              onChange={e => setRuleText(e.target.value)}
              onPressEnter={e => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handlePreview();
                }
              }}
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ marginBottom: 8 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#999' }}>
                <ThunderboltOutlined /> 示例：
                {exampleRules.map((rule, i) => (
                  <Button
                    key={i}
                    type="link"
                    size="small"
                    style={{ fontSize: 12, padding: '0 4px' }}
                    onClick={() => setRuleText(rule)}
                  >
                    {rule}
                  </Button>
                ))}
              </div>
              <Button
                type="primary"
                icon={<EyeOutlined />}
                loading={loading}
                onClick={handlePreview}
                disabled={!ruleText.trim()}
              >
                预览修改
              </Button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <Alert
              type="error"
              message="规则解析失败"
              description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>{error}</pre>}
              showIcon
              closable
              onClose={() => setError(null)}
              style={{ marginBottom: 16 }}
            />
          )}

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Spin size="large" tip={scope === 'single' ? '正在解析修改规则...' : '正在解析多表修改规则...'} />
            </div>
          )}

          {/* Single-table Preview Results */}
          {previewData && !loading && (
            <>
              <Alert
                type="info"
                message={
                  <Space>
                    <span>📝 规则解析：</span>
                    <Text strong>{previewData.explanation}</Text>
                    <Tag color={previewData.engine === 'llm' ? 'purple' : 'blue'}>
                      {previewData.engine === 'llm' ? '🧠 AI 解析' : '⚡ 规则引擎'}
                    </Tag>
                  </Space>
                }
                style={{ marginBottom: 16 }}
              />

              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}>
                  <Statistic
                    title="影响记录数"
                    value={previewData.affected_rows}
                    suffix="条"
                    valueStyle={{ color: previewData.affected_rows > 0 ? '#1677ff' : '#999' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title="修改字段数" value={previewData.affected_fields} suffix="个" />
                </Col>
                <Col span={8}>
                  <Statistic title="总变更数" value={previewData.total_changes} suffix="处" />
                </Col>
              </Row>

              {previewData.changes.length > 0 ? (
                <>
                  <Table
                    size="small"
                    dataSource={previewData.changes}
                    columns={columns}
                    rowKey={(r, i) => `${r.pk_value}_${r.field}_${i}`}
                    pagination={previewData.changes.length > 10 ? { pageSize: 10, size: 'small' } : false}
                    scroll={{ y: 300 }}
                    style={{ marginBottom: 16 }}
                  />

                  {previewData.total_changes > 500 && (
                    <Alert
                      type="warning"
                      message={`变更较多（共 ${previewData.total_changes} 处），当前仅展示前 500 条预览`}
                      style={{ marginBottom: 16 }}
                      showIcon
                    />
                  )}

                  <Alert
                    type="warning"
                    message="⚠️ 修改后将进入差异预览，确认无误后再回写"
                    description="系统会自动创建备份，确认后通过标准回写流程写入数据库"
                    style={{ marginBottom: 16 }}
                    showIcon
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={handleClose} icon={<CloseOutlined />}>取消</Button>
                    <Button onClick={handleReset} icon={<EditOutlined />}>✏️ 调整规则</Button>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      loading={applying}
                      onClick={handleApply}
                    >
                      ✅ 确认修改并预览差异
                    </Button>
                  </div>
                </>
              ) : (
                <Alert
                  type="info"
                  message="没有匹配的记录"
                  description="当前规则未匹配到需要修改的数据，请调整规则后重试"
                  showIcon
                />
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
