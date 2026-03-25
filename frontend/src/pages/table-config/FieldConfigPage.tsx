import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Table, Switch, Input, InputNumber, Button, Space, message, Tag, Spin, Select,
} from 'antd';
import {
  getTableConfig, listFields, updateField, batchUpdateFields, syncFields,
  type TableConfig as TC, type FieldConfig,
} from '../../api/tableConfig';
import { useTranslation } from 'react-i18next';
import AIFieldSuggestModal from './AIFieldSuggestModal';

export default function FieldConfigPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tcId = Number(id);

  const [tc, setTc] = useState<TC | null>(null);
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValues, setEditingValues] = useState<Partial<FieldConfig>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tcRes, fieldsRes] = await Promise.all([
        getTableConfig(tcId),
        listFields(tcId),
      ]);
      setTc(tcRes.data);
      setFields(fieldsRes.data);
    } finally {
      setLoading(false);
    }
  }, [tcId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggle = async (fieldId: number, key: string, value: boolean) => {
    try {
      await updateField(fieldId, { [key]: value ? 1 : 0 });
      setFields(prev => prev.map(f => f.id === fieldId ? { ...f, [key]: value ? 1 : 0 } : f));
    } catch {
      message.error(t('common.failed'));
    }
  };

  const handleInlineEdit = (f: FieldConfig) => {
    setEditingId(f.id);
    setEditingValues({
      field_alias: f.field_alias,
      max_length: f.max_length,
      enum_options_json: f.enum_options_json,
      editable_roles: f.editable_roles,
      sensitivity_level: f.sensitivity_level || 'normal',
      sensitivity_note: f.sensitivity_note || '',
      remark: f.remark,
    });
  };

  const handleSaveInline = async () => {
    if (!editingId) return;
    try {
      await updateField(editingId, editingValues);
      message.success(t('common.success'));
      setEditingId(null);
      fetchData();
    } catch {
      message.error(t('common.failed'));
    }
  };

  const handleBatchUpdate = async (updates: Partial<FieldConfig>) => {
    if (selectedRowKeys.length === 0) { message.warning(t('fieldConfig.batchSelected', { count: 0 })); return; }
    try {
      await batchUpdateFields(selectedRowKeys, updates);
      message.success(t('fieldConfig.batchUpdateSuccess'));
      setSelectedRowKeys([]);
      fetchData();
    } catch {
      message.error(t('common.failed'));
    }
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

  // AI suggestions apply: update local state (not saved to DB until user clicks save)
  const handleAIApply = (updates: Record<number, Partial<FieldConfig>>) => {
    setFields(prev => prev.map(f => {
      const u = updates[f.id];
      if (!u) return f;
      // Don't overwrite fields the user has already manually configured (has alias)
      // unless the update comes from explicit acceptance
      return { ...f, ...u };
    }));
    setUnsavedChanges(true);
  };

  const [unsavedChanges, setUnsavedChanges] = useState(false);

  const handleSaveAll = async () => {
    try {
      // Save all changed fields
      const promises = fields.map(f => updateField(f.id, {
        field_alias: f.field_alias,
        is_editable: f.is_editable,
        is_system_field: f.is_system_field,
        enum_options_json: f.enum_options_json,
      }));
      await Promise.all(promises);
      message.success(t('common.success'));
      setUnsavedChanges(false);
      fetchData();
    } catch {
      message.error(t('common.failed'));
    }
  };

  const boolCol = (title: string, key: string) => ({
    title,
    dataIndex: key,
    width: 80,
    render: (v: number, r: FieldConfig) => (
      <Switch size="small" checked={v === 1} onChange={val => handleToggle(r.id, key, val)} />
    ),
  });

  const columns = [
    { title: t('fieldConfig.order'), dataIndex: 'field_order_no', width: 50 },
    { title: t('fieldConfig.fieldName'), dataIndex: 'field_name', width: 140 },
    {
      title: t('fieldConfig.alias'), dataIndex: 'field_alias', width: 140,
      render: (v: string, r: FieldConfig) => editingId === r.id ? (
        <Input size="small" value={editingValues.field_alias || ''} onChange={e => setEditingValues(p => ({ ...p, field_alias: e.target.value }))} />
      ) : v || '-',
    },
    { title: t('fieldConfig.dbType'), dataIndex: 'db_data_type', width: 110 },
    { title: t('fieldConfig.sampleValue'), dataIndex: 'sample_value', width: 120, ellipsis: true, render: (v: string) => v || '-' },
    boolCol(t('fieldConfig.displayed'), 'is_displayed'),
    boolCol(t('fieldConfig.editable'), 'is_editable'),
    boolCol(t('fieldConfig.required'), 'is_required'),
    {
      title: t('fieldConfig.primaryKey'), dataIndex: 'is_primary_key', width: 60,
      render: (v: number) => v ? <Tag color="blue">PK</Tag> : '-',
    },
    {
      title: t('fieldConfig.systemField'), dataIndex: 'is_system_field', width: 80,
      render: (v: number) => v ? <Tag color="orange">{t('fieldConfig.systemField')}</Tag> : '-',
    },
    boolCol(t('fieldConfig.includeExport'), 'include_in_export'),
    boolCol(t('fieldConfig.includeImport'), 'include_in_import'),
    {
      title: t('fieldConfig.maxLength'), dataIndex: 'max_length', width: 90,
      render: (v: number | null, r: FieldConfig) => editingId === r.id ? (
        <InputNumber size="small" value={editingValues.max_length} onChange={val => setEditingValues(p => ({ ...p, max_length: val ?? undefined }))} style={{ width: 70 }} />
      ) : (v || '-'),
    },
    {
      title: t('fieldConfig.enumOptions'), dataIndex: 'enum_options_json', width: 130, ellipsis: true,
      render: (v: string, r: FieldConfig) => editingId === r.id ? (
        <Input size="small" value={editingValues.enum_options_json || ''} onChange={e => setEditingValues(p => ({ ...p, enum_options_json: e.target.value }))} placeholder={t('fieldConfig.enumPlaceholder')} />
      ) : (v || '-'),
    },
    {
      title: t('fieldConfig.editableRoles'), dataIndex: 'editable_roles', width: 160,
      render: (v: string, r: FieldConfig) => {
        if (editingId === r.id) {
          const currentRoles = (editingValues as any).editable_roles
            ? ((editingValues as any).editable_roles as string).split(',').filter(Boolean)
            : [];
          return (
            <Select
              mode="multiple" size="small" style={{ width: '100%' }}
              placeholder={t('fieldConfig.allRoles')}
              value={currentRoles}
              onChange={(vals: string[]) => setEditingValues(p => ({ ...p, editable_roles: vals.length > 0 ? vals.join(',') : '' }))}
              options={[
                { value: 'admin', label: t('role.admin') },
                { value: 'operator', label: t('role.operator') },
              ]}
            />
          );
        }
        if (!v) return <span style={{ color: '#999' }}>{t('fieldConfig.allRoles')}</span>;
        return v.split(',').filter(Boolean).map(role => (
          <Tag key={role} color={role === 'admin' ? 'blue' : 'green'} style={{ marginRight: 2 }}>
            {t(`role.${role}`)}
          </Tag>
        ));
      },
    },
    {
      title: t('fieldConfig.sensitivityLevel'), dataIndex: 'sensitivity_level', width: 120,
      render: (v: string, r: FieldConfig) => {
        if (editingId === r.id) {
          return (
            <Select
              size="small"
              value={(editingValues as any).sensitivity_level || 'normal'}
              onChange={(val: string) => setEditingValues(p => ({ ...p, sensitivity_level: val }))}
              options={[
                { label: t('fieldConfig.sensitivityNormal'), value: 'normal' },
                { label: t('fieldConfig.sensitivitySensitive'), value: 'sensitive' },
                { label: t('fieldConfig.sensitivityHigh'), value: 'high_sensitive' },
              ]}
              style={{ width: '100%' }}
            />
          );
        }
        const color = v === 'high_sensitive' ? 'red' : v === 'sensitive' ? 'orange' : 'default';
        const label = v === 'high_sensitive' ? t('fieldConfig.sensitivityHigh') : v === 'sensitive' ? t('fieldConfig.sensitivitySensitive') : t('fieldConfig.sensitivityNormal');
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: t('common.operation'), width: 100, fixed: 'right' as const,
      render: (_: unknown, r: FieldConfig) => editingId === r.id ? (
        <Space size="small">
          <Button type="link" size="small" onClick={handleSaveInline}>{t('common.save')}</Button>
          <Button type="link" size="small" onClick={() => setEditingId(null)}>{t('common.cancel')}</Button>
        </Space>
      ) : (
        <Button type="link" size="small" onClick={() => handleInlineEdit(r)}>{t('common.edit')}</Button>
      ),
    },
  ];

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  return (
    <Card
      title={`${t('fieldConfig.title')} — ${tc?.table_alias || tc?.table_name || ''}`}
      extra={
        <Space>
          <AIFieldSuggestModal tableConfigId={tcId} fields={fields} onApply={handleAIApply} />
          {unsavedChanges && (
            <Button size="small" type="primary" onClick={handleSaveAll}>{t('aiSuggest.saveConfig')}</Button>
          )}
          <Button size="small" onClick={handleSyncFields}>{t('fieldConfig.syncFromDb')}</Button>
          <Button size="small" onClick={() => navigate(`/table-config/detail/${tcId}`)}>{t('fieldConfig.backToConfig')}</Button>
          <Button size="small" onClick={() => navigate('/table-config')}>{t('fieldConfig.backToList')}</Button>
        </Space>
      }
    >
      {selectedRowKeys.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
          <Space wrap>
            <span>{t('fieldConfig.batchSelected', { count: selectedRowKeys.length })}</span>
            <Button size="small" onClick={() => handleBatchUpdate({ is_displayed: 1 } as any)}>{t('fieldConfig.batchShowAll')}</Button>
            <Button size="small" onClick={() => handleBatchUpdate({ is_displayed: 0 } as any)}>{t('fieldConfig.batchHideAll')}</Button>
            <Button size="small" onClick={() => handleBatchUpdate({ is_editable: 1 } as any)}>{t('fieldConfig.batchEditableAll')}</Button>
            <Button size="small" onClick={() => handleBatchUpdate({ is_editable: 0 } as any)}>{t('fieldConfig.batchReadonlyAll')}</Button>
            <Button size="small" onClick={() => handleBatchUpdate({ include_in_export: 1 } as any)}>{t('fieldConfig.batchExportAll')}</Button>
            <Button size="small" onClick={() => handleBatchUpdate({ include_in_import: 1 } as any)}>{t('fieldConfig.batchImportAll')}</Button>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>{t('fieldConfig.cancelSelection')}</Button>
          </Space>
        </div>
      )}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={fields}
        size="small"
        pagination={false}
        scroll={{ x: 1600 }}
        rowSelection={{
          selectedRowKeys,
          onChange: keys => setSelectedRowKeys(keys as number[]),
        }}
      />
    </Card>
  );
}
