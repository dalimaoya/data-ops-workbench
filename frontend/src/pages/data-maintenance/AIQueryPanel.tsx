import { useState, useCallback } from 'react';
import { Input, Button, Space, Tag, Tooltip, message, Spin, Alert } from 'antd';
import {
  RobotOutlined, SearchOutlined, CheckOutlined, EditOutlined,
  ReloadOutlined, CloseOutlined, PlusOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { nlQuery } from '../../api/aiNlQuery';
import type { NLQueryFilter, NLQueryResult } from '../../api/aiNlQuery';
import type { ColumnMeta } from '../../api/dataMaintenance';

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
  const [result, setResult] = useState<NLQueryResult | null>(null);
  const [editingFilters, setEditingFilters] = useState<NLQueryFilter[] | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Build field context from columns
  const buildFieldContext = useCallback(() => {
    return columns.map(col => ({
      name: col.field_name,
      display_name: col.field_alias || col.field_name,
      type: col.db_data_type || 'VARCHAR',
      // enum_values would need to be passed if available
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
  };

  const handleFollowUp = () => {
    // Keep current result for context, clear input for new query
    setQueryText('');
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
          查询
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
            <Space wrap>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleConfirm}
              >
                ✅ 确认查询
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
        </>
      )}

      {/* Hints when no result yet */}
      {!loading && !result && (
        <div style={{ color: '#999', fontSize: 12 }}>
          💡 提示：支持时间范围（最近7天/本月/今年）、状态筛选（不是正常/停用的）、数值比较（大于100）等查询方式
        </div>
      )}
    </div>
  );
}
