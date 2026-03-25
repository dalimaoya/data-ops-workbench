import { useState, useCallback } from 'react';
import { Steps, Card, Button, Space, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import StepUpload from './StepUpload';
import StepMatchTables from './StepMatchTables';
import StepMapFields from './StepMapFields';
import StepPreview from './StepPreview';
import type { TableDataItem } from '../../api/smartImport';

const { Title } = Typography;

export interface ParsedTable extends TableDataItem {
  selected?: boolean;
  matchedTableId?: number;
  matchedTableName?: string;
  matchedTableAlias?: string;
  fieldMappings?: any[];
}

export default function SmartImportPage() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);

  // Shared state across steps
  const [fileName, setFileName] = useState('');
  const [, setFileType] = useState('');
  const [parsedTables, setParsedTables] = useState<ParsedTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<ParsedTable[]>([]);

  const steps = [
    { title: t('smartImport.step1Title'), key: 'upload' },
    { title: t('smartImport.step2Title'), key: 'match' },
    { title: t('smartImport.step3Title'), key: 'mapping' },
    { title: t('smartImport.step4Title'), key: 'preview' },
  ];

  const handleUploadComplete = useCallback((data: any) => {
    setFileName(data.file_name);
    setFileType(data.file_type);
    const tables = (data.tables || []).map((t: any) => ({
      ...t,
      selected: t.parseable !== false,
    }));
    setParsedTables(tables);
  }, []);

  const handleNext = () => {
    if (current === 0) {
      const selected = parsedTables.filter(t => t.selected && t.parseable !== false);
      if (selected.length === 0) {
        message.warning(t('smartImport.noTableSelected'));
        return;
      }
      setSelectedTables(selected);
    }
    setCurrent(prev => Math.min(prev + 1, steps.length - 1));
  };

  const handlePrev = () => {
    setCurrent(prev => Math.max(prev - 1, 0));
  };

  const handleReset = () => {
    setCurrent(0);
    setFileName('');
    setFileType('');
    setParsedTables([]);
    setSelectedTables([]);
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        {t('smartImport.title')}
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <Steps
          current={current}
          items={steps.map(s => ({ title: s.title }))}
          size="small"
        />
      </Card>

      <Card>
        {current === 0 && (
          <StepUpload
            parsedTables={parsedTables}
            setParsedTables={setParsedTables}
            onUploadComplete={handleUploadComplete}
            fileName={fileName}
          />
        )}
        {current === 1 && (
          <StepMatchTables
            selectedTables={selectedTables}
            setSelectedTables={setSelectedTables}
          />
        )}
        {current === 2 && (
          <StepMapFields
            selectedTables={selectedTables}
            setSelectedTables={setSelectedTables}
          />
        )}
        {current === 3 && (
          <StepPreview
            selectedTables={selectedTables}
            onReset={handleReset}
          />
        )}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            {current > 0 && (
              <Button onClick={handlePrev}>
                {t('smartImport.prev')}
              </Button>
            )}
            {current < steps.length - 1 && (
              <Button type="primary" onClick={handleNext} disabled={parsedTables.length === 0 && current === 0}>
                {t('smartImport.next')}
              </Button>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
}
