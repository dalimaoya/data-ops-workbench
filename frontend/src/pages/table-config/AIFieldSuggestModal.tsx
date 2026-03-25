import { useState, useCallback } from 'react';
import {
  Modal, Button, Table, Tag, Space, message, Spin, Typography, Alert, Progress,
} from 'antd';
import {
  RobotOutlined, CheckOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { getFieldSuggestions, type FieldSuggestion, type FieldRecommendation } from '../../api/aiSuggest';
import type { FieldConfig } from '../../api/tableConfig';
import { useTranslation } from 'react-i18next';

interface Props {
  tableConfigId: number;
  fields: FieldConfig[];
  onApply: (updates: Record<number, Partial<FieldConfig>>) => void;
}

// Map field_name → FieldConfig for quick lookup
function buildFieldMap(fields: FieldConfig[]): Record<string, FieldConfig> {
  const m: Record<string, FieldConfig> = {};
  for (const f of fields) m[f.field_name] = f;
  return m;
}

// Check if a field has been manually configured (has alias or system field set etc.)
function isManuallyConfigured(f: FieldConfig): boolean {
  return !!(f.field_alias && f.field_alias.trim());
}

export default function AIFieldSuggestModal({ tableConfigId, fields, onApply }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([]);
  const [meta, setMeta] = useState<{ field_count: number; sample_count: number; engine: string; elapsed_ms: number } | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set()); // "colname:property"

  const fieldMap = buildFieldMap(fields);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setSuggestions([]);
    setMeta(null);
    setAccepted(new Set());
    try {
      const res = await getFieldSuggestions({ table_id: tableConfigId, sample_count: 100 });
      const d = res.data?.data || (res.data as any);
      setSuggestions(d.suggestions || []);
      setMeta({ field_count: d.field_count, sample_count: d.sample_count, engine: d.engine, elapsed_ms: d.elapsed_ms });
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('aiSuggest.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [tableConfigId, t]);

  const handleOpen = () => {
    setOpen(true);
    fetchSuggestions();
  };

  // Build updates from accepted suggestions
  const buildUpdates = (acceptSet: Set<string>, onlyDisplayName = false): Record<number, Partial<FieldConfig>> => {
    const updates: Record<number, Partial<FieldConfig>> = {};

    for (const sg of suggestions) {
      const fc = fieldMap[sg.column_name];
      if (!fc) continue;

      for (const rec of sg.recommendations) {
        const key = `${sg.column_name}:${rec.property}`;
        if (!acceptSet.has(key)) continue;
        if (onlyDisplayName && rec.property !== 'display_name') continue;

        if (!updates[fc.id]) updates[fc.id] = {};

        switch (rec.property) {
          case 'display_name':
            updates[fc.id].field_alias = rec.value as string;
            break;
          case 'is_readonly':
            if (rec.value) updates[fc.id].is_editable = 0;
            break;
          case 'is_system_field':
            if (rec.value) updates[fc.id].is_system_field = 1;
            break;
          case 'enum_values':
            updates[fc.id].enum_options_json = JSON.stringify(rec.value);
            break;
          // value_range is informational, not applied
        }
      }
    }
    return updates;
  };

  const toggleAccept = (colName: string, property: string) => {
    const key = `${colName}:${property}`;
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const acceptAll = () => {
    setAccepted(() => {
      const next = new Set<string>();
      for (const sg of suggestions) {
        for (const rec of sg.recommendations) {
          if (rec.property !== 'value_range') {
            next.add(`${sg.column_name}:${rec.property}`);
          }
        }
      }
      return next;
    });
  };

  const acceptOnlyDisplayNames = () => {
    setAccepted(() => {
      const next = new Set<string>();
      for (const sg of suggestions) {
        for (const rec of sg.recommendations) {
          if (rec.property === 'display_name') {
            next.add(`${sg.column_name}:${rec.property}`);
          }
        }
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const updates = buildUpdates(accepted);
    if (Object.keys(updates).length === 0) {
      message.warning(t('aiSuggest.noAccepted'));
      return;
    }
    onApply(updates);
    message.success(t('aiSuggest.applied', { count: Object.keys(updates).length }));
    setOpen(false);
  };

  const propLabel = (p: string) => {
    const map: Record<string, string> = {
      display_name: t('aiSuggest.propDisplayName'),
      is_readonly: t('aiSuggest.propReadonly'),
      is_system_field: t('aiSuggest.propSystemField'),
      enum_values: t('aiSuggest.propEnumValues'),
      value_range: t('aiSuggest.propValueRange'),
    };
    return map[p] || p;
  };

  const propColor = (p: string) => {
    const map: Record<string, string> = {
      display_name: 'blue', is_readonly: 'orange', is_system_field: 'purple',
      enum_values: 'green', value_range: 'default',
    };
    return map[p] || 'default';
  };

  const confidenceTag = (c: number) => {
    if (c >= 0.9) return <Tag color="green">{(c * 100).toFixed(0)}%</Tag>;
    if (c >= 0.7) return <Tag color="gold">{(c * 100).toFixed(0)}%</Tag>;
    return <Tag>{(c * 100).toFixed(0)}%</Tag>;
  };

  const formatValue = (rec: FieldRecommendation) => {
    if (rec.property === 'enum_values' && Array.isArray(rec.value)) {
      return rec.value.join(' / ');
    }
    if (rec.property === 'value_range' && typeof rec.value === 'object') {
      return `${rec.value.min} ~ ${rec.value.max} (avg: ${rec.value.avg})`;
    }
    if (typeof rec.value === 'boolean') return rec.value ? t('common.yes') : t('common.no');
    return String(rec.value);
  };

  // Flatten suggestions into table rows
  interface FlatRow {
    key: string;
    column_name: string;
    property: string;
    value: any;
    reason: string;
    confidence: number;
    isFirst: boolean;
    spanCount: number;
    rec: FieldRecommendation;
    isManual: boolean;
  }

  const flatRows: FlatRow[] = [];
  for (const sg of suggestions) {
    const fc = fieldMap[sg.column_name];
    const manual = fc ? isManuallyConfigured(fc) : false;
    const applicableRecs = sg.recommendations.filter(r => r.property !== 'value_range' || true);
    applicableRecs.forEach((rec, i) => {
      flatRows.push({
        key: `${sg.column_name}:${rec.property}`,
        column_name: sg.column_name,
        property: rec.property,
        value: rec.value,
        reason: rec.reason,
        confidence: rec.confidence,
        isFirst: i === 0,
        spanCount: applicableRecs.length,
        rec,
        isManual: manual,
      });
    });
  }

  const totalAcceptable = suggestions.reduce((n, sg) => n + sg.recommendations.filter(r => r.property !== 'value_range').length, 0);
  const acceptedCount = accepted.size;

  const columns = [
    {
      title: t('aiSuggest.colField'),
      dataIndex: 'column_name',
      width: 140,
      render: (v: string, row: FlatRow) => {
        const obj: any = { children: (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{v}</Typography.Text>
            {row.isManual && <Tag color="cyan" style={{ fontSize: 10 }}>{t('aiSuggest.manualConfigured')}</Tag>}
          </Space>
        ), props: {} as any };
        if (row.isFirst) obj.props.rowSpan = row.spanCount;
        else obj.props.rowSpan = 0;
        return obj;
      },
    },
    {
      title: t('aiSuggest.colProperty'),
      dataIndex: 'property',
      width: 100,
      render: (v: string) => <Tag color={propColor(v)}>{propLabel(v)}</Tag>,
    },
    {
      title: t('aiSuggest.colValue'),
      dataIndex: 'value',
      width: 200,
      render: (_: any, row: FlatRow) => (
        <Typography.Text style={{ maxWidth: 180 }} ellipsis={{ tooltip: true }}>
          {formatValue(row.rec)}
        </Typography.Text>
      ),
    },
    {
      title: t('aiSuggest.colReason'),
      dataIndex: 'reason',
      width: 220,
      render: (v: string) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text>,
    },
    {
      title: t('aiSuggest.colConfidence'),
      dataIndex: 'confidence',
      width: 80,
      render: (v: number) => confidenceTag(v),
    },
    {
      title: t('common.operation'),
      width: 80,
      render: (_: any, row: FlatRow) => {
        if (row.property === 'value_range') return <Typography.Text type="secondary">{t('aiSuggest.infoOnly')}</Typography.Text>;
        const key = row.key;
        const isAccepted = accepted.has(key);
        return (
          <Button
            type={isAccepted ? 'primary' : 'default'}
            size="small"
            icon={isAccepted ? <CheckCircleOutlined /> : <CheckOutlined />}
            onClick={() => toggleAccept(row.column_name, row.property)}
          >
            {isAccepted ? t('aiSuggest.accepted') : t('aiSuggest.accept')}
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <Button
        icon={<RobotOutlined />}
        onClick={handleOpen}
        type="default"
        size="small"
      >
        {t('aiSuggest.btnTitle')}
      </Button>

      <Modal
        title={
          <Space>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span>{t('aiSuggest.modalTitle')}</span>
          </Space>
        }
        open={open}
        onCancel={() => setOpen(false)}
        width={1000}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={acceptOnlyDisplayNames}>{t('aiSuggest.acceptDisplayNamesOnly')}</Button>
            <Button onClick={acceptAll}>{t('aiSuggest.acceptAll')}</Button>
            <Button type="primary" onClick={handleConfirm} disabled={acceptedCount === 0}>
              {t('aiSuggest.confirmApply', { count: acceptedCount })}
            </Button>
          </Space>
        }
        destroyOnClose
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#666' }}>{t('aiSuggest.analyzing')}</div>
          </div>
        ) : (
          <>
            {meta && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  <Space split="·">
                    <span>{t('aiSuggest.metaFields', { count: meta.field_count })}</span>
                    <span>{t('aiSuggest.metaSamples', { count: meta.sample_count })}</span>
                    <span>{t('aiSuggest.metaEngine', { engine: meta.engine === 'builtin_rules+llm' ? t('aiSuggest.engineRulesLLM') : t('aiSuggest.engineRules') })}</span>
                    <span>{t('aiSuggest.metaTime', { ms: meta.elapsed_ms })}</span>
                  </Space>
                }
              />
            )}

            {suggestions.length === 0 && !loading && (
              <Alert type="warning" message={t('aiSuggest.noSuggestions')} style={{ marginBottom: 12 }} />
            )}

            {suggestions.length > 0 && (
              <>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text type="secondary">
                    {t('aiSuggest.progress', { accepted: acceptedCount, total: totalAcceptable })}
                  </Typography.Text>
                  <Progress
                    percent={totalAcceptable > 0 ? Math.round((acceptedCount / totalAcceptable) * 100) : 0}
                    size="small"
                    style={{ width: 150 }}
                  />
                </div>
                <Table
                  rowKey="key"
                  columns={columns}
                  dataSource={flatRows}
                  size="small"
                  pagination={false}
                  scroll={{ y: 450 }}
                  bordered
                />
                <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                  {t('aiSuggest.disclaimer')}
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
