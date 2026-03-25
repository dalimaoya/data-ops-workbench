import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Descriptions, Form, Switch, InputNumber, Button, Space, message, Table, Tag, Spin,
} from 'antd';
import {
  getTableConfig, updateTableConfig, getSampleData, checkStructure, syncFields,
  type TableConfig as TC, type SampleDataResponse,
} from '../../api/tableConfig';
import { useTranslation } from 'react-i18next';

export default function TableConfigDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tc, setTc] = useState<TC | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState<SampleDataResponse | null>(null);
  const [form] = Form.useForm();

  const tcId = Number(id);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tcRes, sampleRes] = await Promise.all([
        getTableConfig(tcId),
        getSampleData(tcId, 5).catch(() => null),
      ]);
      setTc(tcRes.data);
      if (sampleRes) setSample(sampleRes.data);
      form.setFieldsValue({
        allow_export_current: tcRes.data.allow_export_current === 1,
        allow_export_all: tcRes.data.allow_export_all === 1,
        allow_import_writeback: tcRes.data.allow_import_writeback === 1,
        allow_insert_rows: tcRes.data.allow_insert_rows === 1,
        allow_delete_rows: tcRes.data.allow_delete_rows === 1,
        backup_keep_count: tcRes.data.backup_keep_count,
        strict_template_version: tcRes.data.strict_template_version === 1,
        strict_field_order: tcRes.data.strict_field_order === 1,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [tcId]);

  const handleSave = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await updateTableConfig(tcId, {
        allow_export_current: v.allow_export_current ? 1 : 0,
        allow_export_all: v.allow_export_all ? 1 : 0,
        allow_import_writeback: v.allow_import_writeback ? 1 : 0,
        allow_insert_rows: v.allow_insert_rows ? 1 : 0,
        allow_delete_rows: v.allow_delete_rows ? 1 : 0,
        backup_keep_count: v.backup_keep_count,
        strict_template_version: v.strict_template_version ? 1 : 0,
        strict_field_order: v.strict_field_order ? 1 : 0,
      });
      message.success(t('tableDetail.saveSuccess'));
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('common.failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleCheckStructure = async () => {
    const res = await checkStructure(tcId);
    if (res.data.status === 'normal') message.success(res.data.message);
    else if (res.data.status === 'changed') message.warning(res.data.message);
    else message.error(res.data.message);
    fetchData();
  };

  const handleSyncFields = async () => {
    try {
      await syncFields(tcId);
      message.success(t('tableDetail.fieldsSynced'));
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t('common.failed'));
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  if (!tc) return <div>{t('tableDetail.notFound')}</div>;

  const structColor: Record<string, string> = { normal: 'green', changed: 'red', error: 'orange' };
  const structTextKey: Record<string, string> = { normal: 'tableConfig.structureNormal', changed: 'tableConfig.structureChanged', error: 'tableConfig.structureError' };

  const sampleColumns = sample?.columns.map(c => ({
    title: c, dataIndex: c, key: c, ellipsis: true, width: 140,
  })) || [];
  const sampleData = sample?.rows.map((row, idx) => {
    const obj: Record<string, unknown> = { _key: idx };
    sample.columns.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  }) || [];

  return (
    <div>
      <Card title={t('tableDetail.basicInfo')} style={{ marginBottom: 16 }} extra={
        <Space>
          <Button size="small" onClick={handleCheckStructure}>{t('tableDetail.checkStructure')}</Button>
          <Button size="small" onClick={handleSyncFields}>{t('tableDetail.syncFields')}</Button>
          <Button size="small" type="primary" onClick={() => navigate(`/table-config/fields/${tcId}`)}>{t('tableDetail.configFields')}</Button>
        </Space>
      }>
        <Descriptions column={3} bordered size="small">
          <Descriptions.Item label={t('common.datasource')}>{tc.datasource_name}</Descriptions.Item>
          <Descriptions.Item label={t('tableConfig.dbSchema')}>{tc.db_name || tc.schema_name || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('common.tableName')}>{tc.table_name}</Descriptions.Item>
          <Descriptions.Item label={t('tableConfig.tableAlias')}>{tc.table_alias || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('tableConfig.configVersion')}>v{tc.config_version}</Descriptions.Item>
          <Descriptions.Item label={t('tableConfig.fieldCount')}>{tc.field_count}</Descriptions.Item>
          <Descriptions.Item label={t('tableConfig.primaryKeyFields')}>{tc.primary_key_fields}</Descriptions.Item>
          <Descriptions.Item label={t('tableConfig.structureStatus')}>
            <Tag color={structColor[tc.structure_check_status || ''] || 'default'}>
              {structTextKey[tc.structure_check_status || ''] ? t(structTextKey[tc.structure_check_status || '']) : t('tableConfig.structureUnchecked')}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('tableDetail.lastSync')}>{tc.last_sync_at || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={t('tableDetail.maintenanceRules')} style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" style={{ flexWrap: 'wrap', gap: 16 }}>
          <Form.Item name="allow_export_current" label={t('tableDetail.allowExportCurrent')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="allow_export_all" label={t('tableDetail.allowExportAll')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="allow_import_writeback" label={t('tableDetail.allowImportWriteback')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="allow_insert_rows" label={t('tableDetail.allowInsertRows')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="allow_delete_rows" label={t('tableDetail.allowDeleteRows')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="backup_keep_count" label={t('tableDetail.backupKeepCount')}><InputNumber min={1} max={10} /></Form.Item>
          <Form.Item name="strict_template_version" label={t('tableDetail.strictTemplateVersion')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="strict_field_order" label={t('tableDetail.strictFieldOrder')} valuePropName="checked"><Switch /></Form.Item>
        </Form>
        <div style={{ marginTop: 16 }}>
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>{t('tableDetail.saveConfig')}</Button>
            <Button onClick={() => navigate('/table-config')}>{t('tableDetail.backToList')}</Button>
          </Space>
        </div>
      </Card>

      <Card title={t('tableDetail.sampleData')}>
        {sample && sample.rows.length > 0 ? (
          <Table rowKey="_key" columns={sampleColumns} dataSource={sampleData} size="small" pagination={false} scroll={{ x: sampleColumns.length * 140 }} />
        ) : (
          <div>{t('tableDetail.noSampleData')}</div>
        )}
      </Card>
    </div>
  );
}
