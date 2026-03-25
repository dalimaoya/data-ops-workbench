import { useState } from 'react';
import { Table, Tag, Space, Typography, Button, Collapse, Result, Alert, message } from 'antd';
import { CheckCircleOutlined, ReloadOutlined, ExportOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ParsedTable } from './SmartImportPage';

const { Text } = Typography;

interface Props {
  selectedTables: ParsedTable[];
  onReset: () => void;
}

export default function StepPreview({ selectedTables, onReset }: Props) {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  const readyTables = selectedTables.filter(
    t => t.matchedTableId && t.fieldMappings && t.fieldMappings.some(m => m.target_field)
  );

  const handleSubmit = () => {
    // In production, this would call the existing writeback/diff preview APIs
    message.success(t('smartImport.submitSuccess'));
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Result
        status="success"
        title={t('smartImport.importComplete')}
        subTitle={t('smartImport.importCompleteDesc', { count: readyTables.length })}
        extra={[
          <Button key="new" type="primary" icon={<ReloadOutlined />} onClick={onReset}>
            {t('smartImport.newImport')}
          </Button>,
        ]}
      />
    );
  }

  if (readyTables.length === 0) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('smartImport.noReadyTables')}
        description={t('smartImport.goBackToMap')}
      />
    );
  }

  const collapseItems = readyTables.map(tbl => {
    const mappings = tbl.fieldMappings || [];
    const activeMappings = mappings.filter(m => m.target_field);

    // Build preview data using mappings
    const previewColumns = activeMappings.map(m => ({
      title: (
        <div>
          <div>{m.target_alias || m.target_field}</div>
          <div style={{ fontSize: 11, color: '#999', fontWeight: 'normal' }}>← {m.source_column}</div>
        </div>
      ),
      dataIndex: m.target_field,
      key: m.target_field,
      ellipsis: true,
    }));

    const previewData = (tbl.preview_rows || []).map((row, i) => {
      const obj: Record<string, string> = { _key: String(i) };
      activeMappings.forEach(m => {
        const srcIdx = tbl.headers.indexOf(m.source_column);
        obj[m.target_field] = srcIdx >= 0 ? (row[srcIdx] || '') : '';
      });
      return obj;
    });

    return {
      key: String(tbl.table_index),
      label: (
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
          <Text strong>{tbl.title_guess || `#${tbl.table_index + 1}`}</Text>
          <Text type="secondary">→</Text>
          <Text>{tbl.matchedTableAlias || tbl.matchedTableName}</Text>
          <Tag color="blue">
            {activeMappings.length} {t('smartImport.fieldsMapped')}
          </Tag>
          <Tag>
            {tbl.row_count} {t('smartImport.rows')}
          </Tag>
        </Space>
      ),
      children: (
        <Table
          dataSource={previewData}
          columns={previewColumns}
          rowKey="_key"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      ),
    };
  });

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message={t('smartImport.previewInfo', { count: readyTables.length })}
        style={{ marginBottom: 16 }}
      />

      <Collapse
        defaultActiveKey={readyTables.map(t => String(t.table_index))}
        items={collapseItems}
      />

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <Space size="large">
          <Button size="large" icon={<ExportOutlined />} type="primary" onClick={handleSubmit}>
            {t('smartImport.confirmImport')}
          </Button>
        </Space>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">{t('smartImport.confirmHint')}</Text>
        </div>
      </div>
    </div>
  );
}
