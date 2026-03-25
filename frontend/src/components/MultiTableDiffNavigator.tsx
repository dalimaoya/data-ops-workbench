/**
 * MultiTableDiffNavigator — 多表变更对比与导航组件
 *
 * 通用组件，可接收来自 AI 批量填充或批量模板导入的数据。
 * 提供：变更总览、逐表明细、导航、逐表/批量确认、进度指示。
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Card, Table, Tag, Space, Button, Alert, Statistic, Row, Col,
  Progress, Typography, Descriptions, Result, Divider, Badge,
} from 'antd';
import {
  LeftOutlined, RightOutlined, CheckCircleOutlined, CheckCircleFilled,
  CloseCircleOutlined, ExclamationCircleOutlined, TableOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

// ── Types (generic, source-agnostic) ──

export interface TableChange {
  row_index: number;
  pk_value: string;
  field: string;
  field_alias: string;
  old_value: string | null;
  new_value: string;
}

export interface TableDiffData {
  table_id: number;
  table_name: string;            // 表别名 / 显示名
  display_name: string;          // 物理表名
  status: 'has_changes' | 'no_change' | 'skipped' | 'error';
  error: string | null;
  rows_changed: number;
  fields_changed: string[];
  total_changes?: number;
  changes: TableChange[];
  explanation?: string;
  engine?: string;
}

export interface MultiDiffSummary {
  tables_affected: number;
  total_rows_changed: number;
  total_tables: number;
}

export interface MultiDiffProps {
  /** Source label (e.g. 'AI 批量修改' or '批量模板导入') */
  sourceLabel?: string;
  summary: MultiDiffSummary;
  tables: TableDiffData[];
  /** Called when user confirms specific tables */
  onConfirm: (confirmedTableIds: number[]) => Promise<void>;
  /** Called when user cancels all */
  onCancel: () => void;
  /** Whether confirmation is in progress */
  confirming?: boolean;
  /** After confirm, results per table */
  confirmResults?: Array<{
    table_id: number;
    table_name: string;
    status: string;
    updated?: number;
    failed?: number;
    error?: string | null;
  }>;
}

export default function MultiTableDiffNavigator({
  sourceLabel = 'AI 批量修改',
  summary,
  tables,
  onConfirm,
  onCancel,
  confirming = false,
  confirmResults,
}: MultiDiffProps) {
  // Only show tables with actual changes
  const changeTables = useMemo(
    () => tables.filter(t => t.status === 'has_changes'),
    [tables],
  );
  const skippedTables = useMemo(
    () => tables.filter(t => t.status !== 'has_changes'),
    [tables],
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<number>>(new Set());

  const currentTable = changeTables[currentIndex] || null;
  const confirmedCount = confirmedIds.size;
  const totalChangeTables = changeTables.length;
  const progressPercent = totalChangeTables > 0 ? Math.round((confirmedCount / totalChangeTables) * 100) : 0;

  const handleConfirmCurrent = useCallback(() => {
    if (!currentTable) return;
    const next = new Set(confirmedIds);
    next.add(currentTable.table_id);
    setConfirmedIds(next);
    // Auto-advance to next unconfirmed
    if (currentIndex < changeTables.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentTable, confirmedIds, currentIndex, changeTables.length]);

  const handleConfirmAll = useCallback(() => {
    const all = new Set(changeTables.map(t => t.table_id));
    setConfirmedIds(all);
  }, [changeTables]);

  const handleExecute = useCallback(async () => {
    const ids = Array.from(confirmedIds);
    await onConfirm(ids);
  }, [confirmedIds, onConfirm]);

  // ── If we have confirm results, show result view ──
  if (confirmResults) {
    const successCount = confirmResults.filter(r => r.status === 'success').length;
    const failCount = confirmResults.filter(r => r.status === 'error' || r.status === 'failed').length;
    const overallStatus = failCount === 0 ? 'success' : (successCount === 0 ? 'error' : 'warning');

    return (
      <Card>
        <Result
          status={overallStatus}
          title={
            overallStatus === 'success'
              ? '多表回写全部成功'
              : overallStatus === 'error'
              ? '多表回写失败'
              : '多表回写部分成功'
          }
          subTitle={`成功 ${successCount} 张表，失败 ${failCount} 张表`}
        />
        <Table
          size="small"
          dataSource={confirmResults}
          rowKey="table_id"
          pagination={false}
          columns={[
            { title: '表名', dataIndex: 'table_name', key: 'table_name' },
            {
              title: '状态', dataIndex: 'status', key: 'status',
              render: (s: string) => (
                <Tag color={s === 'success' ? 'green' : s === 'skipped' ? 'default' : 'red'}>
                  {s === 'success' ? '✅ 成功' : s === 'skipped' ? '⏭ 跳过' : '❌ 失败'}
                </Tag>
              ),
            },
            { title: '更新行数', dataIndex: 'updated', key: 'updated', render: (v?: number) => v ?? '-' },
            { title: '失败行数', dataIndex: 'failed', key: 'failed', render: (v?: number) => v ?? '-' },
            { title: '错误信息', dataIndex: 'error', key: 'error', render: (v?: string | null) => v || '-' },
          ]}
        />
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Button onClick={onCancel}>关闭</Button>
        </div>
      </Card>
    );
  }

  // ── Columns for the detail diff table ──
  const detailColumns = [
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
      width: 180,
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
      width: 180,
      render: (v: string) => (
        <span style={{ color: '#389e0d', background: '#f6ffed', padding: '1px 6px', borderRadius: 2 }}>
          {v}
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* ── 变更总览 ── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <ThunderboltOutlined style={{ fontSize: 20, color: '#1677ff', marginRight: 8 }} />
            <Text strong style={{ fontSize: 16 }}>多表变更对比</Text>
            <Tag color="blue" style={{ marginLeft: 8 }}>{sourceLabel}</Tag>
          </Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />

        <Row gutter={24}>
          <Col span={8}>
            <Statistic
              title="受影响表数"
              value={summary.tables_affected}
              suffix={`/ ${summary.total_tables} 张`}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="总变更记录"
              value={summary.total_rows_changed}
              suffix="条"
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="已确认"
              value={confirmedCount}
              suffix={`/ ${totalChangeTables} 张表`}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
        </Row>

        {/* Summary table */}
        <Table
          size="small"
          dataSource={changeTables}
          rowKey="table_id"
          pagination={false}
          style={{ marginTop: 16 }}
          onRow={(_, index) => ({
            style: {
              cursor: 'pointer',
              background: index === currentIndex ? '#e6f4ff' : undefined,
            },
            onClick: () => setCurrentIndex(index!),
          })}
          columns={[
            {
              title: '表名', dataIndex: 'table_name', key: 'table_name',
              render: (name: string, record: TableDiffData) => (
                <Space>
                  <TableOutlined />
                  <span>{name}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>({record.display_name})</Text>
                  {confirmedIds.has(record.table_id) && (
                    <CheckCircleFilled style={{ color: '#52c41a' }} />
                  )}
                </Space>
              ),
            },
            { title: '变更行数', dataIndex: 'rows_changed', key: 'rows_changed', width: 100 },
            {
              title: '变更字段数', key: 'fields_count', width: 100,
              render: (_: unknown, record: TableDiffData) => record.fields_changed.length,
            },
            {
              title: '状态', key: 'confirm_status', width: 100,
              render: (_: unknown, record: TableDiffData) =>
                confirmedIds.has(record.table_id)
                  ? <Tag color="green"><CheckCircleOutlined /> 已确认</Tag>
                  : <Tag color="orange"><ExclamationCircleOutlined /> 待确认</Tag>,
            },
          ]}
        />

        {/* Skipped tables info */}
        {skippedTables.length > 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message={
              <span>
                {skippedTables.length} 张表无变更或跳过：
                {skippedTables.map(t => (
                  <Tag key={t.table_id} style={{ marginLeft: 4 }}>
                    {t.table_name}
                    {t.error && <Text type="secondary" style={{ fontSize: 11 }}> ({t.error})</Text>}
                  </Tag>
                ))}
              </span>
            }
          />
        )}
      </Card>

      {/* ── 逐表变更明细 ── */}
      {currentTable && (
        <Card
          size="small"
          title={
            <Space>
              <Badge
                count={confirmedIds.has(currentTable.table_id) ? '✅' : `${currentIndex + 1}/${totalChangeTables}`}
                style={{
                  backgroundColor: confirmedIds.has(currentTable.table_id) ? '#52c41a' : '#1677ff',
                }}
              />
              <span>当前查看：{currentTable.table_name}</span>
              <Text type="secondary">({currentTable.display_name})</Text>
              {currentTable.engine && (
                <Tag color={currentTable.engine === 'llm' ? 'purple' : 'blue'}>
                  {currentTable.engine === 'llm' ? '🧠 AI 解析' : '⚡ 规则引擎'}
                </Tag>
              )}
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {currentTable.explanation && (
            <Alert
              type="info"
              message={`📝 ${currentTable.explanation}`}
              style={{ marginBottom: 12 }}
            />
          )}

          <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="变更行数">{currentTable.rows_changed}</Descriptions.Item>
            <Descriptions.Item label="变更字段">{currentTable.fields_changed.join(', ')}</Descriptions.Item>
            <Descriptions.Item label="总变更数">{currentTable.total_changes ?? currentTable.changes.length}</Descriptions.Item>
          </Descriptions>

          <Table
            size="small"
            dataSource={currentTable.changes}
            columns={detailColumns}
            rowKey={(r, i) => `${r.pk_value}_${r.field}_${i}`}
            pagination={currentTable.changes.length > 10 ? { pageSize: 10, size: 'small' } : false}
            scroll={{ y: 300 }}
          />

          {(currentTable.total_changes ?? 0) > 500 && (
            <Alert
              type="warning"
              message={`变更较多（共 ${currentTable.total_changes} 处），当前仅展示前 500 条`}
              showIcon
              style={{ marginTop: 8 }}
            />
          )}
        </Card>
      )}

      {/* ── 导航 + 确认按钮 ── */}
      <Card size="small">
        {/* Progress bar */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>确认进度：已确认 {confirmedCount}/{totalChangeTables} 张表</Text>
          <Progress
            percent={progressPercent}
            status={confirmedCount === totalChangeTables ? 'success' : 'active'}
            style={{ marginTop: 4 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {/* Navigation */}
          <Space>
            <Button
              icon={<LeftOutlined />}
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex(currentIndex - 1)}
            >
              上一个表
              {currentIndex > 0 && changeTables[currentIndex - 1] && confirmedIds.has(changeTables[currentIndex - 1].table_id) && ' ✅'}
            </Button>
            <Button
              disabled={currentIndex >= changeTables.length - 1}
              onClick={() => setCurrentIndex(currentIndex + 1)}
            >
              下一个表
              {currentIndex < changeTables.length - 1 && changeTables[currentIndex + 1] && confirmedIds.has(changeTables[currentIndex + 1].table_id) && ' ✅'}
              <RightOutlined />
            </Button>
          </Space>

          {/* Actions */}
          <Space>
            <Button
              danger
              icon={<CloseCircleOutlined />}
              onClick={onCancel}
              disabled={confirming}
            >
              ❌ 取消全部
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              onClick={handleConfirmCurrent}
              disabled={!currentTable || confirmedIds.has(currentTable.table_id) || confirming}
            >
              ✅ 确认当前表
            </Button>
            <Button
              type="dashed"
              icon={<CheckCircleOutlined />}
              onClick={handleConfirmAll}
              disabled={confirmedCount === totalChangeTables || confirming}
            >
              ✅✅ 批量确认全部
            </Button>
            {confirmedCount > 0 && (
              <Button
                type="primary"
                loading={confirming}
                onClick={handleExecute}
                disabled={confirmedCount === 0}
              >
                🚀 执行回写（{confirmedCount} 张表）
              </Button>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
}
