import { useState, useEffect } from 'react';
import { Table, Tag, Select, Button, Space, Typography, Collapse, Spin, message, Modal, Input, Alert } from 'antd';
import { RobotOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { mapFields, createMappingTemplate } from '../../api/smartImport';
import type { ParsedTable } from './SmartImportPage';

const { Text } = Typography;

interface FieldMapping {
  source_column: string;
  target_field: string | null;
  target_alias: string | null;
  confidence: number;
  match_type: string;
  candidates: Array<{
    field_name: string;
    field_alias: string;
    confidence: number;
    match_type: string;
  }>;
}

interface Props {
  selectedTables: ParsedTable[];
  setSelectedTables: (tables: ParsedTable[]) => void;
}

const MATCH_TYPE_COLORS: Record<string, string> = {
  exact: 'green',
  synonym: 'cyan',
  fuzzy: 'orange',
  ai: 'purple',
  unmatched: 'default',
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: 'smartImport.matchExact',
  synonym: 'smartImport.matchSynonym',
  fuzzy: 'smartImport.matchFuzzy',
  ai: 'smartImport.matchAI',
  unmatched: 'smartImport.matchUnmatched',
};

export default function StepMapFields({ selectedTables, setSelectedTables }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [mappingsMap, setMappingsMap] = useState<Record<number, FieldMapping[]>>({});
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savingTableIndex, setSavingTableIndex] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState('');

  const matchedTables = selectedTables.filter(t => t.matchedTableId);

  useEffect(() => {
    if (matchedTables.length > 0) {
      setActiveKey([String(matchedTables[0].table_index)]);
      doMapAll(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doMapAll = async (useAi: boolean) => {
    setLoading(true);
    const newMap: Record<number, FieldMapping[]> = {};

    for (const tbl of matchedTables) {
      if (!tbl.matchedTableId) continue;
      try {
        const res = await mapFields(tbl.headers, tbl.matchedTableId, useAi);
        if (res.data?.success) {
          newMap[tbl.table_index] = res.data.data.mappings;

          // If template matched, show notification
          const tmpl = res.data.data.matched_template;
          if (tmpl) {
            message.info(t('smartImport.templateMatched', { name: tmpl.template_name, similarity: Math.round(tmpl.similarity * 100) }));
          }
        }
      } catch (err) {
        console.error('Map fields error:', err);
      }
    }

    setMappingsMap(newMap);

    // Update selectedTables with mappings
    setSelectedTables(
      selectedTables.map(st => {
        const m = newMap[st.table_index];
        return m ? { ...st, fieldMappings: m } : st;
      })
    );

    setLoading(false);
  };

  const handleFieldChange = (tableIndex: number, sourceColumn: string, targetField: string | null) => {
    setMappingsMap(prev => {
      const mappings = [...(prev[tableIndex] || [])];
      const idx = mappings.findIndex(m => m.source_column === sourceColumn);
      if (idx >= 0) {
        mappings[idx] = {
          ...mappings[idx],
          target_field: targetField,
          match_type: targetField ? 'manual' : 'unmatched',
          confidence: targetField ? 1.0 : 0,
        };
      }
      return { ...prev, [tableIndex]: mappings };
    });
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || savingTableIndex === null) return;
    const tbl = matchedTables.find(t => t.table_index === savingTableIndex);
    if (!tbl || !tbl.matchedTableId) return;

    const mappings = mappingsMap[savingTableIndex] || [];
    try {
      await createMappingTemplate({
        template_name: templateName.trim(),
        target_table_id: tbl.matchedTableId,
        mappings: mappings.filter(m => m.target_field).map(m => ({
          source_pattern: m.source_column,
          target_field: m.target_field,
          match_type: m.match_type,
        })),
        source_headers: tbl.headers,
      });
      message.success(t('smartImport.templateSaved'));
      setSaveModalOpen(false);
      setTemplateName('');
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('common.failed'));
    }
  };

  if (matchedTables.length === 0) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('smartImport.noMatchedTables')}
        description={t('smartImport.goBackToMatch')}
      />
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>{t('smartImport.mappingFields')}</div>
      </div>
    );
  }

  const collapseItems = matchedTables.map(tbl => {
    const mappings = mappingsMap[tbl.table_index] || [];
    const matchedCount = mappings.filter(m => m.target_field).length;

    const columns = [
      {
        title: t('smartImport.sourceColumn'),
        dataIndex: 'source_column',
        width: 200,
        render: (val: string) => <Text strong>{val}</Text>,
      },
      {
        title: '',
        width: 40,
        render: () => <SwapOutlined style={{ color: '#999' }} />,
      },
      {
        title: t('smartImport.targetField'),
        dataIndex: 'target_field',
        width: 250,
        render: (val: string | null, record: FieldMapping) => {
          if (val) {
            return (
              <Space>
                <Text>{record.target_alias || val}</Text>
                <Text type="secondary">({val})</Text>
              </Space>
            );
          }
          return <Tag color="error">{t('smartImport.unmatched')}</Tag>;
        },
      },
      {
        title: t('smartImport.confidence'),
        dataIndex: 'confidence',
        width: 100,
        render: (val: number) =>
          val > 0 ? (
            <Tag color={val >= 0.8 ? 'green' : val >= 0.5 ? 'orange' : 'red'}>
              {Math.round(val * 100)}%
            </Tag>
          ) : (
            <Text type="secondary">—</Text>
          ),
      },
      {
        title: t('smartImport.matchMethod'),
        dataIndex: 'match_type',
        width: 100,
        render: (val: string) => (
          <Tag color={MATCH_TYPE_COLORS[val] || 'default'}>
            {t(MATCH_TYPE_LABELS[val] || 'smartImport.matchUnmatched')}
          </Tag>
        ),
      },
      {
        title: t('common.actions'),
        width: 180,
        render: (_: any, record: FieldMapping) => (
          <Select
            size="small"
            style={{ width: 160 }}
            placeholder={t('smartImport.selectField')}
            allowClear
            value={record.target_field}
            onChange={(val) => handleFieldChange(tbl.table_index, record.source_column, val)}
            options={record.candidates?.map(c => ({
              value: c.field_name,
              label: `${c.field_alias} (${c.field_name}) ${Math.round(c.confidence * 100)}%`,
            }))}
          />
        ),
      },
    ];

    return {
      key: String(tbl.table_index),
      label: (
        <Space>
          <Text strong>{tbl.title_guess || `#${tbl.table_index + 1}`}</Text>
          <Text type="secondary">→</Text>
          <Text>{tbl.matchedTableAlias || tbl.matchedTableName}</Text>
          <Tag color="blue">{matchedCount}/{mappings.length}</Tag>
        </Space>
      ),
      children: (
        <div>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">
              {t('smartImport.mappingSummary', { matched: matchedCount, total: mappings.length })}
            </Text>
            <Button
              size="small"
              icon={<SaveOutlined />}
              onClick={() => {
                setSavingTableIndex(tbl.table_index);
                setTemplateName(tbl.title_guess || '');
                setSaveModalOpen(true);
              }}
            >
              {t('smartImport.saveTemplate')}
            </Button>
          </div>
          <Table
            dataSource={mappings}
            columns={columns}
            rowKey="source_column"
            size="small"
            pagination={false}
          />
        </div>
      ),
    };
  });

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button icon={<RobotOutlined />} onClick={() => doMapAll(true)} loading={loading}>
          {t('smartImport.aiEnhance')}
        </Button>
      </div>

      <Collapse
        activeKey={activeKey}
        onChange={(keys) => setActiveKey(typeof keys === 'string' ? [keys] : keys as string[])}
        items={collapseItems}
      />

      <Modal
        title={t('smartImport.saveTemplateTitle')}
        open={saveModalOpen}
        onOk={handleSaveTemplate}
        onCancel={() => { setSaveModalOpen(false); setTemplateName(''); }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <div style={{ marginBottom: 8 }}>
          <Text>{t('smartImport.templateNameLabel')}</Text>
        </div>
        <Input
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          placeholder={t('smartImport.templateNamePlaceholder')}
        />
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">{t('smartImport.templateHint')}</Text>
        </div>
      </Modal>
    </div>
  );
}
