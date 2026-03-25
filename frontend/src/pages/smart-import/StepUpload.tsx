import { useState } from 'react';
import { Upload, Button, Table, Tag, Space, Typography, Checkbox, Empty, Spin, message } from 'antd';
import { UploadOutlined, FileExcelOutlined, FileWordOutlined, FilePdfOutlined, FileTextOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { parseFile } from '../../api/smartImport';
import type { ParsedTable } from './SmartImportPage';

const { Text } = Typography;

interface Props {
  parsedTables: ParsedTable[];
  setParsedTables: (tables: ParsedTable[]) => void;
  onUploadComplete: (data: any) => void;
  fileName: string;
}

const FILE_ICONS: Record<string, React.ReactNode> = {
  excel: <FileExcelOutlined style={{ color: '#52c41a', fontSize: 20 }} />,
  word: <FileWordOutlined style={{ color: '#1677ff', fontSize: 20 }} />,
  pdf: <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />,
  csv: <FileTextOutlined style={{ color: '#faad14', fontSize: 20 }} />,
};

export default function StepUpload({ parsedTables, setParsedTables, onUploadComplete, fileName }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const handleUpload = async (file: File) => {
    setLoading(true);
    try {
      const res = await parseFile(file);
      if (res.data?.success && res.data?.data) {
        onUploadComplete(res.data.data);
        message.success(t('smartImport.parseSuccess', { count: res.data.data.tables_found }));
      } else {
        message.error(res.data?.detail || t('smartImport.parseFailed'));
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || t('smartImport.parseFailed');
      message.error(detail);
    } finally {
      setLoading(false);
    }
    return false; // prevent default upload
  };

  const toggleSelect = (index: number, checked: boolean) => {
    setParsedTables(
      parsedTables.map(t => t.table_index === index ? { ...t, selected: checked } : t)
    );
  };

  const columns = [
    {
      title: '',
      dataIndex: 'selected',
      width: 50,
      render: (_: any, record: ParsedTable) => (
        <Checkbox
          checked={record.selected}
          disabled={!record.parseable}
          onChange={e => toggleSelect(record.table_index, e.target.checked)}
        />
      ),
    },
    {
      title: t('smartImport.tableIndex'),
      dataIndex: 'table_index',
      width: 80,
      render: (val: number) => `#${val + 1}`,
    },
    {
      title: t('smartImport.sourceLocation'),
      dataIndex: 'source_location',
      width: 160,
    },
    {
      title: t('smartImport.titleGuess'),
      dataIndex: 'title_guess',
      render: (val: string | null, record: ParsedTable) => {
        if (!record.parseable) {
          return <Tag color="error">{t('smartImport.imageTable')}</Tag>;
        }
        return val || <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('smartImport.dimensions'),
      width: 140,
      render: (_: any, record: ParsedTable) =>
        record.parseable
          ? `${record.row_count} ${t('smartImport.rows')} × ${record.col_count} ${t('smartImport.cols')}`
          : '—',
    },
    {
      title: t('smartImport.headers'),
      dataIndex: 'headers',
      ellipsis: true,
      render: (headers: string[]) =>
        headers?.length > 0
          ? headers.slice(0, 4).join(', ') + (headers.length > 4 ? '...' : '')
          : '—',
    },
    {
      title: t('common.actions'),
      width: 80,
      render: (_: any, record: ParsedTable) =>
        record.parseable && (
          <Button
            type="link"
            icon={<EyeOutlined />}
            size="small"
            onClick={() => setExpandedRow(expandedRow === record.table_index ? null : record.table_index)}
          >
            {t('smartImport.preview')}
          </Button>
        ),
    },
  ];

  const selectedCount = parsedTables.filter(t => t.selected && t.parseable).length;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Upload
          accept=".xlsx,.xls,.docx,.pdf,.csv"
          beforeUpload={handleUpload}
          showUploadList={false}
          disabled={loading}
        >
          <Button icon={<UploadOutlined />} type="primary" loading={loading}>
            {loading ? t('smartImport.parsing') : t('smartImport.uploadFile')}
          </Button>
        </Upload>
        <Text type="secondary" style={{ marginLeft: 12 }}>
          {t('smartImport.supportedFormats')}
        </Text>
      </div>

      {fileName && (
        <div style={{ marginBottom: 12 }}>
          <Space>
            {FILE_ICONS[parsedTables[0]?.source_location?.includes('Sheet') ? 'excel' : 'csv'] || FILE_ICONS.csv}
            <Text strong>{fileName}</Text>
            <Tag>{t('smartImport.tablesFound', { count: parsedTables.length })}</Tag>
            <Tag color="blue">{t('smartImport.selected', { count: selectedCount })}</Tag>
          </Space>
        </div>
      )}

      {parsedTables.length > 0 ? (
        <Table
          dataSource={parsedTables}
          columns={columns}
          rowKey="table_index"
          size="small"
          pagination={false}
          expandable={{
            expandedRowKeys: expandedRow !== null ? [expandedRow] : [],
            expandedRowRender: (record: ParsedTable) => (
              <div style={{ padding: 8 }}>
                <Table
                  dataSource={record.preview_rows?.map((row, i) => {
                    const obj: Record<string, string> = { _key: String(i) };
                    record.headers?.forEach((h, j) => { obj[h || `col_${j}`] = row[j] || ''; });
                    return obj;
                  })}
                  columns={record.headers?.map((h, i) => ({
                    title: h || `Col ${i + 1}`,
                    dataIndex: h || `col_${i}`,
                    ellipsis: true,
                  }))}
                  rowKey="_key"
                  size="small"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
              </div>
            ),
            showExpandColumn: false,
          }}
        />
      ) : !loading ? (
        <Empty description={t('smartImport.uploadHint')} />
      ) : (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" tip={t('smartImport.parsing')} />
        </div>
      )}
    </div>
  );
}
