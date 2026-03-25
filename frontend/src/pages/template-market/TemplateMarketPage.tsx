import { useState, useEffect } from 'react';
import { Card, List, Button, Modal, Select, Input, message, Tag, Space, Table } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/request';

export default function TemplateMarketPage() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<string>('');
  const [datasources, setDatasources] = useState<any[]>([]);
  const [selectedDs, setSelectedDs] = useState<number | null>(null);
  const [tablePrefix, setTablePrefix] = useState('');
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    api.get('/api/template-market/templates').then(res => setTemplates(res.data.templates || [])).catch(() => {});
    api.get('/api/datasource').then(res => setDatasources(res.data.items || [])).catch(() => {});
  }, []);

  const handlePreview = async (id: string) => {
    try {
      const res = await api.get(`/api/template-market/templates/${id}`);
      setPreviewData(res.data.template);
      setPreviewOpen(true);
    } catch { message.error('加载失败'); }
  };

  const handleImport = async () => {
    if (!selectedDs || !importTarget) return;
    setImportLoading(true);
    try {
      const res = await api.post('/api/template-market/import', {
        template_id: importTarget,
        datasource_id: selectedDs,
        table_prefix: tablePrefix,
      });
      message.success(`${t('templateMarket.importSuccess')}: 创建 ${res.data.created?.length || 0} 张表`);
      setImportOpen(false);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '导入失败');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div>
      <Card title={<Space><ShopOutlined />{t('templateMarket.title')}</Space>}>
        <List
          grid={{ gutter: 16, column: 3 }}
          dataSource={templates}
          loading={loading}
          renderItem={(item: any) => (
            <List.Item>
              <Card
                size="small"
                title={<Space>{item.name}<Tag color={item.is_builtin ? 'blue' : 'green'}>{item.is_builtin ? t('templateMarket.builtin') : t('templateMarket.custom')}</Tag></Space>}
                actions={[
                  <Button type="link" onClick={() => handlePreview(item.id)}>{t('templateMarket.preview')}</Button>,
                  <Button type="link" onClick={() => { setImportTarget(item.id); setImportOpen(true); }}>{t('templateMarket.import')}</Button>,
                ]}
              >
                <p style={{ color: '#666', fontSize: 13 }}>{item.description}</p>
                <p><Tag>{item.category}</Tag> {t('templateMarket.tableCount')}: {item.table_count}</p>
              </Card>
            </List.Item>
          )}
        />
      </Card>

      <Modal title={t('templateMarket.preview')} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={800}>
        {previewData?.tables?.map((tbl: any, i: number) => (
          <Card key={i} size="small" title={`${tbl.table_name} — ${tbl.comment || ''}`} style={{ marginBottom: 8 }}>
            <Table
              size="small" pagination={false}
              columns={[
                { title: '字段名', dataIndex: 'name', key: 'name' },
                { title: '类型', dataIndex: 'type', key: 'type' },
                { title: '说明', dataIndex: 'comment', key: 'comment' },
              ]}
              dataSource={tbl.columns}
              rowKey="name"
            />
          </Card>
        ))}
      </Modal>

      <Modal title={t('templateMarket.import')} open={importOpen} onCancel={() => setImportOpen(false)} onOk={handleImport} confirmLoading={importLoading}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>{t('templateMarket.selectDatasource')}</div>
          <Select style={{ width: '100%' }} value={selectedDs} onChange={setSelectedDs}>
            {datasources.map(ds => <Select.Option key={ds.id} value={ds.id}>{ds.datasource_name}</Select.Option>)}
          </Select>
        </div>
        <div>
          <div style={{ marginBottom: 4 }}>{t('templateMarket.tablePrefix')}</div>
          <Input value={tablePrefix} onChange={e => setTablePrefix(e.target.value)} placeholder="可选，如 my_" />
        </div>
      </Modal>
    </div>
  );
}
