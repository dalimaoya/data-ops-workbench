import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Modal, Button, Table, Tag, Space, Alert, Statistic, Row, Col, message, Spin, Typography,
  Checkbox, Collapse, Progress, Tooltip, Badge,
} from 'antd';
import {
  RobotOutlined, BulbOutlined, CheckCircleOutlined, CloseOutlined,
  ThunderboltOutlined, ExperimentOutlined, SyncOutlined,
} from '@ant-design/icons';
import { smartFillDetect, smartFillApply } from '../../api/aiSmartFill';
import type { SmartFillFieldResult, SmartFillSuggestion } from '../../api/aiSmartFill';

const { Text } = Typography;
const { Panel } = Collapse;

interface ColumnMeta {
  field_name: string;
  field_alias: string;
  is_editable?: boolean;
  is_primary_key?: boolean;
  is_system_field?: boolean;
}

interface AISmartFillModalProps {
  open: boolean;
  onClose: () => void;
  tableConfigId: number;
  tableAlias?: string;
  columns: ColumnMeta[];
}

type FillSelection = Record<string, Record<number, boolean>>; // field -> rowIndex -> selected

export default function AISmartFillModal({
  open, onClose, tableConfigId, tableAlias, columns,
}: AISmartFillModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'select' | 'detect' | 'preview'>('select');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [useLlm, setUseLlm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Record<string, SmartFillFieldResult> | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Track which suggestions are selected for apply
  const [fillSelections, setFillSelections] = useState<FillSelection>({});

  // Editable columns for selection
  const editableColumns = columns.filter(
    c => c.is_editable && !c.is_primary_key && !c.is_system_field
  );

  useEffect(() => {
    if (open) {
      setStep('select');
      setSelectedFields([]);
      setResults(null);
      setError(null);
      setFillSelections({});
    }
  }, [open]);

  const handleDetect = async () => {
    if (selectedFields.length === 0) {
      message.warning('请至少选择一列');
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await smartFillDetect(tableConfigId, selectedFields, useLlm);
      const data = res.data.data;
      setResults(data.fields);
      setTotalRows(data.total_rows);

      // Initialize selections: default select all suggestions with confidence >= 0.7
      const selections: FillSelection = {};
      for (const [field, result] of Object.entries(data.fields)) {
        selections[field] = {};
        for (const s of result.suggestions) {
          selections[field][s.row_index] = s.confidence >= 0.7;
        }
      }
      setFillSelections(selections);
      setStep('preview');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail || '模式检测失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!results) return;

    // Build fills from selections
    const fills: Array<{ row_index: number; field: string; value: string }> = [];
    for (const [field, fieldResult] of Object.entries(results)) {
      const fieldSel = fillSelections[field] || {};
      for (const s of fieldResult.suggestions) {
        if (fieldSel[s.row_index]) {
          fills.push({ row_index: s.row_index, field, value: s.suggested_value });
        }
      }
    }

    if (fills.length === 0) {
      message.warning('请至少选择一条填充建议');
      return;
    }

    setApplying(true);
    try {
      const res = await smartFillApply(tableConfigId, fills);
      message.success(`已生成填充任务（${res.data.fill_count} 个单元格），正在跳转到差异预览...`);
      onClose();
      navigate(`/data-maintenance/diff/${res.data.task_id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      message.error(err?.response?.data?.detail || '应用填充失败');
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    setStep('select');
    setSelectedFields([]);
    setResults(null);
    setError(null);
    setFillSelections({});
    onClose();
  };

  const toggleFieldSuggestion = (field: string, rowIndex: number, checked: boolean) => {
    setFillSelections(prev => ({
      ...prev,
      [field]: { ...prev[field], [rowIndex]: checked },
    }));
  };

  const selectAllForField = (field: string, checked: boolean) => {
    if (!results) return;
    const fieldResult = results[field];
    if (!fieldResult) return;
    setFillSelections(prev => {
      const updated = { ...prev[field] };
      for (const s of fieldResult.suggestions) {
        updated[s.row_index] = checked;
      }
      return { ...prev, [field]: updated };
    });
  };

  // Count total selected fills
  const totalSelectedFills = Object.values(fillSelections).reduce((acc, fieldSel) => {
    return acc + Object.values(fieldSel).filter(Boolean).length;
  }, 0);

  const patternTypeLabel = (type: string) => {
    const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
      numeric_increment: { label: '数字递增', color: 'blue', icon: <SyncOutlined /> },
      date_increment: { label: '日期递增', color: 'cyan', icon: <SyncOutlined /> },
      frequency: { label: '频率填充', color: 'green', icon: <ThunderboltOutlined /> },
      association: { label: '关联填充', color: 'purple', icon: <BulbOutlined /> },
      llm: { label: 'AI 模式', color: 'magenta', icon: <ExperimentOutlined /> },
    };
    return map[type] || { label: type, color: 'default', icon: null };
  };

  const confidenceColor = (conf: number) => {
    if (conf >= 0.8) return '#52c41a';
    if (conf >= 0.5) return '#faad14';
    return '#ff4d4f';
  };

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: '#722ed1' }} />
          <span>🧠 AI 智能填充</span>
          {tableAlias && <Tag>{tableAlias}</Tag>}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={step === 'preview' ? 960 : 640}
      footer={null}
      destroyOnClose
    >
      {/* ── Step 1: Select columns ── */}
      {step === 'select' && (
        <>
          <Alert
            type="info"
            message="AI 智能填充会分析已有数据的模式，为空白单元格推荐填充值"
            description="支持：数字/日期递增检测、频率分布填充、字段关联推断"
            showIcon
            icon={<BulbOutlined />}
            style={{ marginBottom: 16 }}
          />

          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              选择需要填充的列：
            </Text>
            <Checkbox.Group
              value={selectedFields}
              onChange={vals => setSelectedFields(vals as string[])}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {editableColumns.map(c => (
                <Checkbox key={c.field_name} value={c.field_name}>
                  {c.field_alias || c.field_name}
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                    ({c.field_name})
                  </Text>
                </Checkbox>
              ))}
            </Checkbox.Group>
            {editableColumns.length === 0 && (
              <Text type="secondary">没有可编辑的字段</Text>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <Checkbox
              checked={useLlm}
              onChange={e => setUseLlm(e.target.checked)}
            >
              <Space>
                <ExperimentOutlined />
                <span>启用 AI 增强模式</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  （需要已配置大模型，更智能但较慢）
                </Text>
              </Space>
            </Checkbox>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Space>
              <Button
                size="small"
                onClick={() => setSelectedFields(editableColumns.map(c => c.field_name))}
              >
                全选
              </Button>
              <Button size="small" onClick={() => setSelectedFields([])}>
                清空
              </Button>
            </Space>
            <Button
              type="primary"
              icon={<BulbOutlined />}
              loading={loading}
              onClick={handleDetect}
              disabled={selectedFields.length === 0}
            >
              开始检测模式
            </Button>
          </div>
        </>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#666' }}>
            正在分析数据模式，检测 {selectedFields.length} 个字段...
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert
          type="error"
          message="检测失败"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* ── Step 2: Preview results ── */}
      {step === 'preview' && results && !loading && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Statistic title="表总行数" value={totalRows} suffix="行" />
            </Col>
            <Col span={6}>
              <Statistic title="检测字段数" value={Object.keys(results).length} suffix="个" />
            </Col>
            <Col span={6}>
              <Statistic
                title="可填充数"
                value={Object.values(results).reduce((acc, r) => acc + r.suggestions.length, 0)}
                suffix="处"
                valueStyle={{ color: '#722ed1' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="已选填充"
                value={totalSelectedFills}
                suffix="处"
                valueStyle={{ color: '#1677ff' }}
              />
            </Col>
          </Row>

          <Collapse defaultActiveKey={Object.keys(results)} style={{ marginBottom: 16 }}>
            {Object.entries(results).map(([field, result]) => {
              const fieldSelCount = Object.values(fillSelections[field] || {}).filter(Boolean).length;
              const bestPattern = result.patterns[0];

              return (
                <Panel
                  key={field}
                  header={
                    <Space>
                      <Text strong>{result.field_alias}</Text>
                      <Text type="secondary">({field})</Text>
                      <Tag>空白 {result.blank_count} / 已填 {result.filled_count}</Tag>
                      {bestPattern && (
                        <Tag
                          color={patternTypeLabel(bestPattern.type).color}
                          icon={patternTypeLabel(bestPattern.type).icon}
                        >
                          {patternTypeLabel(bestPattern.type).label}
                        </Tag>
                      )}
                      {result.suggestions.length > 0 && (
                        <Badge
                          count={`已选 ${fieldSelCount}/${result.suggestions.length}`}
                          style={{ backgroundColor: fieldSelCount > 0 ? '#722ed1' : '#d9d9d9' }}
                        />
                      )}
                    </Space>
                  }
                >
                  {/* Pattern info */}
                  {bestPattern && (
                    <Alert
                      type="info"
                      message={
                        <Space>
                          <span>检测到模式：</span>
                          <Text strong>{bestPattern.description}</Text>
                          <Tooltip title={`置信度 ${(bestPattern.confidence * 100).toFixed(0)}%`}>
                            <Progress
                              type="circle"
                              percent={Math.round(bestPattern.confidence * 100)}
                              size={28}
                              strokeColor={confidenceColor(bestPattern.confidence)}
                            />
                          </Tooltip>
                        </Space>
                      }
                      style={{ marginBottom: 12 }}
                    />
                  )}

                  {result.message && !result.suggestions.length && (
                    <Alert type="warning" message={result.message} showIcon style={{ marginBottom: 12 }} />
                  )}

                  {/* Suggestions table */}
                  {result.suggestions.length > 0 && (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <Space>
                          <Button
                            size="small"
                            onClick={() => selectAllForField(field, true)}
                          >
                            全选
                          </Button>
                          <Button
                            size="small"
                            onClick={() => selectAllForField(field, false)}
                          >
                            取消全选
                          </Button>
                          <Button
                            size="small"
                            onClick={() => {
                              // Select only high-confidence
                              setFillSelections(prev => {
                                const updated = { ...prev[field] };
                                for (const s of result.suggestions) {
                                  updated[s.row_index] = s.confidence >= 0.8;
                                }
                                return { ...prev, [field]: updated };
                              });
                            }}
                          >
                            仅选高置信度
                          </Button>
                        </Space>
                      </div>
                      <Table
                        size="small"
                        dataSource={result.suggestions}
                        rowKey={r => `${field}_${r.row_index}`}
                        pagination={result.suggestions.length > 8 ? { pageSize: 8, size: 'small' } : false}
                        scroll={{ y: 240 }}
                        columns={[
                          {
                            title: '',
                            key: 'select',
                            width: 40,
                            render: (_: unknown, record: SmartFillSuggestion) => (
                              <Checkbox
                                checked={fillSelections[field]?.[record.row_index] ?? false}
                                onChange={e => toggleFieldSuggestion(field, record.row_index, e.target.checked)}
                              />
                            ),
                          },
                          {
                            title: '行号',
                            dataIndex: 'row_index',
                            key: 'row_index',
                            width: 70,
                            render: (v: number) => v + 1,
                          },
                          {
                            title: '建议填充值',
                            dataIndex: 'suggested_value',
                            key: 'suggested_value',
                            render: (v: string) => (
                              <span
                                style={{
                                  color: '#722ed1',
                                  background: '#f9f0ff',
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  fontWeight: 500,
                                }}
                              >
                                {v}
                              </span>
                            ),
                          },
                          {
                            title: '置信度',
                            dataIndex: 'confidence',
                            key: 'confidence',
                            width: 100,
                            render: (v: number) => (
                              <Progress
                                percent={Math.round(v * 100)}
                                size="small"
                                strokeColor={confidenceColor(v)}
                                style={{ width: 80 }}
                              />
                            ),
                          },
                        ]}
                      />
                    </>
                  )}
                </Panel>
              );
            })}
          </Collapse>

          {totalSelectedFills > 0 && (
            <Alert
              type="warning"
              message="⚠️ 填充后将进入差异预览，确认无误后再回写数据库"
              description="系统会自动创建备份，确认后通过标准回写流程写入"
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep('select')} icon={<CloseOutlined />}>
              ← 重新选择
            </Button>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={applying}
                onClick={handleApply}
                disabled={totalSelectedFills === 0}
              >
                ✅ 确认填充 ({totalSelectedFills} 处)
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  );
}
