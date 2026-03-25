import { useState, useEffect } from 'react';
import { Card, Radio, Tag, Space, Typography, Button, Spin, message, Alert } from 'antd';
import { RobotOutlined, CheckCircleOutlined, QuestionCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { matchTables } from '../../api/smartImport';
import type { ParsedTable } from './SmartImportPage';

const { Text } = Typography;

interface Props {
  selectedTables: ParsedTable[];
  setSelectedTables: (tables: ParsedTable[]) => void;
}

interface MatchCandidate {
  table_config_id: number;
  table_name: string;
  table_alias: string;
  confidence: number;
  match_reason: string;
}

interface MatchResult {
  table_index: number;
  source_title: string | null;
  candidates: MatchCandidate[];
}

export default function StepMatchTables({ selectedTables, setSelectedTables }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [hasMatched, setHasMatched] = useState(false);

  useEffect(() => {
    if (!hasMatched && selectedTables.length > 0) {
      doMatch(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doMatch = async (useAi: boolean) => {
    setLoading(true);
    try {
      const payload = selectedTables.map(t => ({
        table_index: t.table_index,
        source_location: t.source_location,
        title_guess: t.title_guess,
        row_count: t.row_count,
        col_count: t.col_count,
        headers: t.headers,
        preview_rows: t.preview_rows || [],
        all_rows: [],
        parseable: t.parseable !== false,
      }));
      const res = await matchTables(payload, useAi);
      if (res.data?.success) {
        const results: MatchResult[] = res.data.data;
        setMatchResults(results);
        setHasMatched(true);

        // Auto-select high-confidence matches
        const updated = selectedTables.map(st => {
          const mr = results.find(r => r.table_index === st.table_index);
          if (mr && mr.candidates.length > 0 && mr.candidates[0].confidence >= 0.7) {
            return {
              ...st,
              matchedTableId: mr.candidates[0].table_config_id,
              matchedTableName: mr.candidates[0].table_name,
              matchedTableAlias: mr.candidates[0].table_alias,
            };
          }
          return st;
        });
        setSelectedTables(updated);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('smartImport.matchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTarget = (tableIndex: number, candidate: MatchCandidate | null) => {
    setSelectedTables(
      selectedTables.map(st =>
        st.table_index === tableIndex
          ? {
              ...st,
              matchedTableId: candidate?.table_config_id,
              matchedTableName: candidate?.table_name,
              matchedTableAlias: candidate?.table_alias,
            }
          : st
      )
    );
  };

  const matchedCount = selectedTables.filter(t => t.matchedTableId).length;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>{t('smartImport.matching')}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Text>{t('smartImport.matchSummary', { total: selectedTables.length, matched: matchedCount })}</Text>
        </Space>
        <Button icon={<RobotOutlined />} onClick={() => doMatch(true)} loading={loading}>
          {t('smartImport.aiEnhance')}
        </Button>
      </div>

      {selectedTables.map(st => {
        const mr = matchResults.find(r => r.table_index === st.table_index);
        const candidates = mr?.candidates || [];
        // topConf removed

        let statusIcon = <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
        let statusTag = <Tag color="error">{t('smartImport.unmatched')}</Tag>;
        if (st.matchedTableId) {
          statusIcon = <CheckCircleOutlined style={{ color: '#52c41a' }} />;
          statusTag = <Tag color="success">{t('smartImport.matched')}</Tag>;
        } else if (candidates.length > 0) {
          statusIcon = <QuestionCircleOutlined style={{ color: '#faad14' }} />;
          statusTag = <Tag color="warning">{t('smartImport.needConfirm')}</Tag>;
        }

        return (
          <Card
            key={st.table_index}
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <Space>
                {statusIcon}
                <Text strong>
                  {st.title_guess || `${t('smartImport.table')} #${st.table_index + 1}`}
                </Text>
                <Text type="secondary">
                  ({st.row_count} {t('smartImport.rows')} × {st.col_count} {t('smartImport.cols')})
                </Text>
                {statusTag}
              </Space>
            }
          >
            {candidates.length > 0 ? (
              <Radio.Group
                value={st.matchedTableId}
                onChange={e => {
                  const c = candidates.find(c => c.table_config_id === e.target.value);
                  handleSelectTarget(st.table_index, c || null);
                }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {candidates.map(c => (
                    <Radio key={c.table_config_id} value={c.table_config_id}>
                      <Space>
                        <Text strong>{c.table_alias}</Text>
                        <Text type="secondary">({c.table_name})</Text>
                        <Tag color={c.confidence >= 0.8 ? 'green' : c.confidence >= 0.5 ? 'orange' : 'default'}>
                          {Math.round(c.confidence * 100)}%
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{c.match_reason}</Text>
                      </Space>
                    </Radio>
                  ))}
                  <Radio value={undefined}>
                    <Text type="secondary">{t('smartImport.skipTable')}</Text>
                  </Radio>
                </Space>
              </Radio.Group>
            ) : (
              <Alert
                type="warning"
                showIcon
                message={t('smartImport.noMatchFound')}
                description={t('smartImport.noMatchHint')}
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}
