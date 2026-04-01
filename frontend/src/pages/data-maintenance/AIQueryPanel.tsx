import { useState, useCallback } from 'react';
import { Input, Button, Space, Tag, Tooltip, message, Spin, Alert, Table, Typography } from 'antd';
import {
  RobotOutlined, SearchOutlined, CheckOutlined, EditOutlined,
  ReloadOutlined, CloseOutlined, PlusOutlined, DeleteOutlined,
  CodeOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import { nlQuery, nlQueryExecute } from '../../api/aiNlQuery';
import type { NLQueryFilter, NLQueryResult, NLQueryExecuteResult } from '../../api/aiNlQuery';
import type { ColumnMeta } from '../../api/dataMaintenance';

const { Text } = Typography;

interface AIQueryPanelProps {
  tableConfigId: number;
  columns: ColumnMeta[];
  onApplyFilters: (filters: NLQueryFilter[]) => void;
  onClose: () => void;
}

const OPERATOR_LABELS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  like: '包含',
  not_like: '不包含',
  is_null: '为空',
  is_not_null: '不为空',
  in: '在',
  not_in: '不在',
  between: '介于',
};

const OPERATOR_COLORS: Record<string, string> = {
  eq: 'blue',
  neq: 'red',
  gt: 'orange',
  gte: 'orange',
  lt: 'cyan',
  lte: 'cyan',
  like: 'green',
  not_like: 'magenta',
  is_null: 'default',
  is_not_null: 'default',
};

export default function AIQueryPanel({ tableConfigId, columns, onApplyFilters, onClose }: AIQueryPanelProps) {
  const [queryText, setQueryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<NLQueryResult | null>(null);
  const [execResult, setExecResult] = useState<NLQueryExecuteResult | null>(null);
  const [execPage, setExecPage] = useState(1);
  const [editingFilters, setEditingFilters] = useState<NLQueryFilter[] | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showSql, setShowSql] = useState(false);

  // Build field context from columns
  const buildFieldContext = useCallback(() => {
    return columns.map(col => ({
      name: col.field_name,
      display_name: col.field_alias || col.field_name,
      type: col.db_data_type || 'VARCHAR',
    }));
  }, [columns]);

  const handleQuery = async () => {
    const text = queryText.trim();
    if (!text) {
      message.warning('请输入查询描述');
      return;
    }
    setLoading(true);
    setIsEditing(false);
    setExecResult(null);
    try {
      const previousFilters = result?.filters || [];
      const res = await nlQuery({
        table_id: tableConfigId,
        query_text: text,
        context: {
          fields: buildFieldContext(),
          previous_filters: previousFilters.length > 0 ? previousFilters : undefined,
        },
      });
      if (res.data.success && res.data.data) {
        setResult(res.data.data);
        setEditingFilters(null);
        if (!res.data.data.filters || res.data.data.filters.length === 0) {
          message.info('未能解析出筛选条件，请尝试换个方式描述');
        }
      } else {
        message.error('查询解析失败');
      }
    } catch {
      message.error('AI 查询服务异常');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async (page = 1) => {
    const filters = isEditing && editingFilters ? editingFilters : result?.filters;
    if (!filters || filters.length === 0) {
      message.warning('没有可执行的筛选条件');
      return;
    }
    setExecuting(true);
    try {
      const res = await nlQueryExecute({
        table_id: tableConfigId,
        filters,
        sql_preview: result?.sql_preview,
        page,
        page_size: 50,
      });
      if (res.data.success && res.data.data) {
        setExecResult(res.data.data);
        setExecPage(page);
        message.success(`查询完成，共 ${res.data.data.total} 条结果`);
      } else {
        message.error('查询执行失败');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '查询执行失败');
    } finally {
      setExecuting(false);
    }
  };

  const handleConfirm = () => {
    const filters = isEditing && editingFilters ? editingFilters : result?.filters;
    if (filters && filters.length > 0) {
      onApplyFilters(filters);
      message.success(`已应用 ${filters.length} 个筛选条件`);
    } else {
      message.warning('没有可应用的筛选条件');
    }
  };

  const handleReset = () => {
    setQueryText('');
    setResult(null);
    setEditingFilters(null);
    setIsEditing(false);
    setExecResult(null);
    setShowSql(false);
  };

  const handleFollowUp = () => {
    setQueryText('');
    setExecResult(null);
  };

  const handleEditMode = () => {
    if (result?.filters) {
      setEditingFilters([...result.filters]);
      setIsEditing(true);
    }
  };

  const handleRemoveFilter = (index: number) => {
    if (editingFilters) {
      const next = editingFilters.filter((_, i) => i !== index);
      setEditingFilters(next);
    }
  };

  const displayFilters = isEditing && editingFilters ? editingFilters : result?.filters;

  // Build table columns for execute result
  const execColumns = execResult?.columns?.map(c => ({
    title: c.field_alias || c.field_name,
    dataIndex: c.field_name,
    key: c.field_name,
    ellipsis: true,
    width: 150,
  })) || [];

  return (
    <div style={{
      background: '#f0f7ff',
      border: '1px solid #91caff',
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <RobotOutlined style={{ fontSize: 18, color: '#1677ff' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>AI 自然语言查询</span>
          {result?.engine && (
            <Tag color="default" style={{ fontSize: 11 }}>
              {result.engine === 'llm' ? '🧠 LLM' : '📐 规则引擎'}
            </Tag>
          )}
        </Space>
        <Button type="text" icon={<CloseOutlined />} size="small" onClick={onClose} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input.TextArea
          placeholder="用自然语言描述你想查的数据，例如：找出最近7天更新过的、状态不是正常的记录"
          value={queryText}
          onChange={e => setQueryText(e.target.value)}
          onPressEnter={e => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleQuery();
            }
          }}
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ flex: 1 }}
          disabled={loading}
        />
        <Button
          type="primary"
          icon={<SearchOutlined />}
          loading={loading}
          onClick={handleQuery}
          style={{ alignSelf: 'flex-end' }}
        >
          解析
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Spin tip="AI 分析中..." />
        </div>
      )}

      {/* Results */}
      {!loading && result && (
        <>
          {/* Explanation */}
          {result.explanation && (
            <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
              💡 {result.explanation}
              {result.confidence > 0 && (
                <Tag
                  color={result.confidence >= 0.8 ? 'green' : result.confidence >= 0.5 ? 'orange' : 'red'}
                  style={{ marginLeft: 8, fontSize: 11 }}
                >
                  置信度 {Math.round(result.confidence * 100)}%
                </Tag>
              )}
            </div>
          )}

          {/* Filter conditions */}
          {displayFilters && displayFilters.length > 0 && (
            <div style={{
              background: '#fff',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 12,
              border: '1px solid #e8e8e8',
            }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>
                AI 理解的筛选条件：
              </div>
              {displayFilters.map((filter, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 0',
                  borderBottom: idx < displayFilters.length - 1 ? '1px dashed #f0f0f0' : undefined,
                }}>
                  <Tag color={OPERATOR_COLORS[filter.operator] || 'default'} style={{ minWidth: 28, textAlign: 'center' }}>
                    {OPERATOR_LABELS[filter.operator] || filter.operator}
                  </Tag>
                  <span style={{ flex: 1, fontSize: 13 }}>{filter.display}</span>
                  {isEditing && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveFilter(idx)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* SQL Preview */}
          {result.sql_preview && displayFilters && displayFilters.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Button
                type="link"
                size="small"
                icon={<CodeOutlined />}
                onClick={() => setShowSql(!showSql)}
                style={{ padding: 0, fontSize: 12 }}
              >
                {showSql ? '隐藏 SQL 预览' : '查看 SQL 预览'}
              </Button>
              {showSql && (
                <div style={{
                  background: '#1e1e1e',
                  color: '#d4d4d4',
                  borderRadius: 6,
                  padding: '10px 14px',
                  marginTop: 6,
                  fontFamily: "'Fira Code', 'Consolas', monospace",
                  fontSize: 12,
                  lineHeight: 1.6,
                  overflowX: 'auto',
                }}>
                  <Text copyable={{ text: result.sql_preview }} style={{ color: '#d4d4d4' }}>
                    {result.sql_preview}
                  </Text>
                </div>
              )}
            </div>
          )}

          {/* No filters */}
          {(!displayFilters || displayFilters.length === 0) && (
            <Alert
              type="info"
              showIcon
              message="未能解析出筛选条件"
              description={'请尝试使用更明确的描述，例如："最近7天的数据"、"状态不是正常的"、"金额大于1000"'}
              style={{ marginBottom: 12 }}
            />
          )}

          {/* Action buttons */}
          {displayFilters && displayFilters.length > 0 && (
            <Space wrap style={{ marginBottom: execResult ? 12 : 0 }}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={executing}
                onClick={() => handleExecute(1)}
              >
                ✅ 确认执行查询
              </Button>
              <Button onClick={handleConfirm}>
                📋 应用为筛选条件
              </Button>
              {!isEditing ? (
                <Button icon={<EditOutlined />} onClick={handleEditMode}>
                  ✏️ 修改条件
                </Button>
              ) : (
                <Button icon={<CheckOutlined />} onClick={() => { setIsEditing(false); }}>
                  完成修改
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                🔄 重新描述
              </Button>
              <Tooltip title="在已有条件基础上继续补充">
                <Button icon={<PlusOutlined />} onClick={handleFollowUp}>
                  ➕ 追问补充
                </Button>
              </Tooltip>
            </Space>
          )}

          {/* Execute Result Table */}
          {execResult && (
            <div style={{
              background: '#fff',
              borderRadius: 6,
              border: '1px solid #e8e8e8',
              marginTop: 8,
            }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong style={{ fontSize: 13 }}>
                  🔍 查询结果（共 {execResult.total} 条）
                </Text>
              </div>
              <Table
                dataSource={execResult.rows}
                columns={execColumns}
                rowKey={(_, i) => String(i)}
                size="small"
                scroll={{ x: 'max-content' }}
                pagination={{
                  current: execPage,
                  pageSize: execResult.page_size,
                  total: execResult.total,
                  showTotal: (t) => `共 ${t} 条`,
                  showSizeChanger: false,
                  onChange: (p) => handleExecute(p),
                }}
              />
            </div>
          )}
        </>
      )}

      {/* Hints when no result yet */}
      {!loading && !result && (
        <div style={{ color: '#999', fontSize: 12 }}>
          💡 提示：支持时间范围（最近7天/本月/今年）、状态筛选（不是正常/停用的）、数值比较（大于100）、空值检查（为空/不为空）等查询方式。
          AI 会先解析您的意图并展示 SQL 预览，确认后再执行查询。
        </div>
      )}
    </div>
  );
}
