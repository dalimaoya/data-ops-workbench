import { useState } from 'react';
import { Button, Card, Tag, Table, Alert, Space, Descriptions } from 'antd';
import { RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { impactAssess } from '../../api/aiImpactAssess';
import { useTranslation } from 'react-i18next';
import { checkAIAvailable } from '../../utils/aiGuard';

interface Props {
  tableId: number;
  changes: Array<{
    row_pk?: string;
    field_name?: string;
    old_value?: string;
    new_value?: string;
    change_type?: string;
  }>;
}

const levelConfig: Record<string, { color: string; icon: string; label: string }> = {
  high: { color: 'red', icon: '🔴', label: '高风险' },
  medium: { color: 'orange', icon: '🟡', label: '中风险' },
  low: { color: 'green', icon: '🟢', label: '低风险' },
};

export default function ImpactAssessPanel({ tableId, changes }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);

  const doAssess = async () => {
    if (!(await checkAIAvailable())) return;
    setLoading(true);
    try {
      const res = await impactAssess({ table_id: tableId, changes });
      setResult(res.data.data);
      setExpanded(true);
    } catch (e: any) {
      setResult({ error: e?.response?.data?.detail || t('common.failed') });
    } finally {
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <Button
        icon={<RobotOutlined />}
        loading={loading}
        onClick={doAssess}
        style={{ marginLeft: 8 }}
      >
        🤖 {t('impact.assess')}
      </Button>
    );
  }

  if (result?.error) {
    return (
      <Card size="small" style={{ marginTop: 12 }} title={<span><RobotOutlined /> {t('impact.title')}</span>} extra={<Button size="small" onClick={() => setExpanded(false)}>{t('common.close')}</Button>}>
        <Alert type="error" message={result.error} />
      </Card>
    );
  }

  if (!result) return null;

  const { overall_level, risks, summary } = result;
  const cfg = levelConfig[overall_level] || levelConfig.low;

  const riskColumns = [
    {
      title: t('impact.riskLevel'),
      dataIndex: 'level',
      width: 100,
      render: (v: string) => {
        const c = levelConfig[v] || levelConfig.low;
        return <Tag color={c.color}>{c.icon} {c.label}</Tag>;
      },
    },
    { title: t('impact.riskType'), dataIndex: 'type', width: 150, render: (v: string) => t(`impact.type_${v}`, v) },
    { title: t('impact.description'), dataIndex: 'message' },
    { title: t('impact.suggestion'), dataIndex: 'suggestion', width: 250 },
  ];

  return (
    <Card
      size="small"
      style={{ marginTop: 12 }}
      title={
        <Space>
          <SafetyCertificateOutlined />
          {t('impact.title')}
          <Tag color={cfg.color}>{cfg.icon} {cfg.label}</Tag>
        </Space>
      }
      extra={<Button size="small" onClick={() => setExpanded(false)}>{t('common.close')}</Button>}
    >
      <Descriptions size="small" bordered column={3} style={{ marginBottom: 12 }}>
        <Descriptions.Item label={t('impact.totalChanges')}>{summary?.total_changes || 0}</Descriptions.Item>
        <Descriptions.Item label={t('impact.changeRows')}>{summary?.change_rows || 0}</Descriptions.Item>
        <Descriptions.Item label={t('impact.historicalWritebacks')}>{summary?.historical_writebacks || 0}</Descriptions.Item>
      </Descriptions>

      <Table
        dataSource={risks}
        columns={riskColumns}
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
      />
    </Card>
  );
}
