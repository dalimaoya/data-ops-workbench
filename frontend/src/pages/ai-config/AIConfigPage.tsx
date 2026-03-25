import { useState, useEffect } from 'react';
import {
  Card, Switch, Radio, Select, Input, InputNumber, Slider, Button, Form,
  Space, Divider, Typography, message, Spin, Alert, Tag,
} from 'antd';
import {
  RobotOutlined, ApiOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, EyeOutlined, EyeInvisibleOutlined,
  SaveOutlined, UndoOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  getAIConfig, updateAIConfig, testAIConnection,
  getAIValidateConfig, updateAIValidateConfig,
  type AIConfigData, type AIConfigUpdateData, type AIValidateConfig,
} from '../../api/aiConfig';

const { Title, Text } = Typography;

// ── Preset platforms ──
interface PlatformPreset {
  name: string;
  labelZh: string;
  labelEn: string;
  apiUrl: string;
  protocol: string;
  models: string[];
}

const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    name: 'deepseek', labelZh: 'DeepSeek', labelEn: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1', protocol: 'openai',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    name: 'qwen', labelZh: '通义千问 (Qwen)', labelEn: 'Qwen (Alibaba)',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  },
  {
    name: 'siliconflow', labelZh: '硅基流动', labelEn: 'SiliconFlow',
    apiUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai',
    models: ['deepseek-v3', 'qwen2.5-72b'],
  },
  {
    name: 'zhipu', labelZh: '智谱 GLM', labelEn: 'Zhipu GLM',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai',
    models: ['glm-4', 'glm-4-flash'],
  },
  {
    name: 'baidu', labelZh: '百度文心', labelEn: 'Baidu ERNIE',
    apiUrl: 'https://qianfan.baidubce.com/v2', protocol: 'openai',
    models: ['ernie-4.0-8k', 'ernie-3.5-8k'],
  },
  {
    name: 'kimi', labelZh: '月之暗面 Kimi', labelEn: 'Moonshot Kimi',
    apiUrl: 'https://api.moonshot.cn/v1', protocol: 'openai',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    name: 'openai', labelZh: 'OpenAI', labelEn: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1', protocol: 'openai',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    name: 'claude', labelZh: 'Anthropic Claude', labelEn: 'Anthropic Claude',
    apiUrl: 'https://api.anthropic.com', protocol: 'claude',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
  },
  {
    name: 'yi', labelZh: '零一万物 Yi', labelEn: 'Yi (01.AI)',
    apiUrl: 'https://api.lingyiwanwu.com/v1', protocol: 'openai',
    models: ['yi-large', 'yi-medium'],
  },
  {
    name: 'custom', labelZh: '自定义接口', labelEn: 'Custom',
    apiUrl: '', protocol: 'openai',
    models: [],
  },
];

const FEATURE_KEYS = [
  { key: 'field_suggest', zhLabel: '智能字段配置', enLabel: 'Smart Field Config' },
  { key: 'data_validate', zhLabel: '智能校验', enLabel: 'Smart Validation' },
  { key: 'nl_query', zhLabel: '自然语言查询', enLabel: 'Natural Language Query' },
  { key: 'log_analyze', zhLabel: '日志分析', enLabel: 'Log Analysis' },
  { key: 'batch_fill', zhLabel: '智能填充', enLabel: 'Smart Fill' },
  { key: 'health_check', zhLabel: '健康巡检', enLabel: 'Health Check' },
  { key: 'impact_assess', zhLabel: '影响评估', enLabel: 'Impact Assessment' },
];

export default function AIConfigPage() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [config, setConfig] = useState<AIConfigData | null>(null);
  const [validateConfig, setValidateConfig] = useState<AIValidateConfig | null>(null);
  const [form] = Form.useForm();
  const [showLocalApiKey, setShowLocalApiKey] = useState(false);
  const [showCloudApiKey, setShowCloudApiKey] = useState(false);
  const [localApiKeyInput, setLocalApiKeyInput] = useState('');
  const [cloudApiKeyInput, setCloudApiKeyInput] = useState('');

  // Track selected platform for model dropdown
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformPreset | null>(null);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await getAIConfig();
      setConfig(res.data);
      form.setFieldsValue({
        ai_enabled: res.data.ai_enabled,
        engine_mode: res.data.engine_mode,
        // Local fields
        local_api_protocol: res.data.local_api_protocol,
        local_api_url: res.data.local_api_url,
        local_model_name: res.data.local_model_name || undefined,
        local_max_tokens: res.data.local_max_tokens,
        local_temperature: res.data.local_temperature,
        // Cloud fields
        cloud_platform_name: res.data.cloud_platform_name || undefined,
        cloud_api_protocol: res.data.cloud_api_protocol,
        cloud_api_url: res.data.cloud_api_url,
        cloud_model_name: res.data.cloud_model_name || undefined,
        cloud_max_tokens: res.data.cloud_max_tokens,
        cloud_temperature: res.data.cloud_temperature,
      });
      const preset = PLATFORM_PRESETS.find(p => p.name === res.data.cloud_platform_name);
      setSelectedPlatform(preset || null);
      try {
        const vcRes = await getAIValidateConfig();
        setValidateConfig(vcRes.data);
      } catch {
        // ignore
      }
    } catch {
      message.error(t('common.failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfig(); }, []);

  const handlePlatformChange = (platformName: string) => {
    const preset = PLATFORM_PRESETS.find(p => p.name === platformName);
    setSelectedPlatform(preset || null);
    if (preset) {
      form.setFieldsValue({
        cloud_platform_name: platformName,
        cloud_api_url: preset.apiUrl,
        cloud_api_protocol: preset.protocol,
        cloud_model_name: preset.models[0] || undefined,
      });
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const values = form.getFieldsValue(true);
      const engineMode = values.engine_mode;

      // Always send engine_mode + ai_enabled + feature_flags
      const data: AIConfigUpdateData = {
        ai_enabled: values.ai_enabled,
        engine_mode: engineMode,
        feature_flags: config?.feature_flags,
      };

      // Only send the current mode's config (avoid overwriting the other)
      if (engineMode === 'local') {
        data.local_api_protocol = values.local_api_protocol;
        data.local_api_url = values.local_api_url;
        data.local_model_name = values.local_model_name;
        data.local_max_tokens = values.local_max_tokens;
        data.local_temperature = values.local_temperature;
        if (localApiKeyInput) {
          data.local_api_key = localApiKeyInput;
        }
      } else if (engineMode === 'cloud') {
        data.cloud_platform_name = values.cloud_platform_name;
        data.cloud_api_protocol = values.cloud_api_protocol;
        data.cloud_api_url = values.cloud_api_url;
        data.cloud_model_name = values.cloud_model_name;
        data.cloud_max_tokens = values.cloud_max_tokens;
        data.cloud_temperature = values.cloud_temperature;
        if (cloudApiKeyInput) {
          data.cloud_api_key = cloudApiKeyInput;
        }
      }

      const res = await updateAIConfig(data);
      setConfig(res.data);
      setLocalApiKeyInput('');
      setCloudApiKeyInput('');
      message.success(t('common.success'));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('common.failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const values = form.getFieldsValue(true);
      const engineMode = values.engine_mode;

      let testData: any;
      if (engineMode === 'local') {
        testData = {
          api_protocol: values.local_api_protocol,
          api_url: values.local_api_url,
          api_key: localApiKeyInput || undefined,
          model_name: values.local_model_name,
          max_tokens: values.local_max_tokens,
          temperature: values.local_temperature,
          test_mode: 'local',
        };
      } else {
        testData = {
          api_protocol: values.cloud_api_protocol,
          api_url: values.cloud_api_url,
          api_key: cloudApiKeyInput || undefined,
          model_name: values.cloud_model_name,
          max_tokens: values.cloud_max_tokens,
          temperature: values.cloud_temperature,
          test_mode: 'cloud',
        };
      }

      const res = await testAIConnection(testData);
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.response?.data?.detail || t('common.failed'),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleReset = () => {
    fetchConfig();
    setLocalApiKeyInput('');
    setCloudApiKeyInput('');
    setTestResult(null);
  };

  const handleFeatureToggle = (key: string, checked: boolean) => {
    if (!config) return;
    const flags = { ...config.feature_flags, [key]: checked };
    setConfig({ ...config, feature_flags: flags });
  };

  const engineMode = Form.useWatch('engine_mode', form);
  const aiEnabled = Form.useWatch('ai_enabled', form);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Card
      title={
        <Space>
          <RobotOutlined />
          <span>{t('aiConfig.title')}</span>
        </Space>
      }
      style={{ margin: 0 }}
      styles={{ body: { padding: '16px 24px' } }}
    >
      <Form form={form} layout="vertical" initialValues={{ ai_enabled: true, engine_mode: 'builtin' }}>

        {/* ── AI Master Switch ── */}
        <div style={{ marginBottom: 8 }}>
          <Form.Item name="ai_enabled" valuePropName="checked" label={t('aiConfig.masterSwitch')} style={{ marginBottom: 4 }}>
            <Switch checkedChildren={t('common.enable')} unCheckedChildren={t('common.disable')} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('aiConfig.masterSwitchHint')}</Text>
        </div>

        {aiEnabled && (
          <>
            <Divider />

            {/* ── Engine Mode ── */}
            <Title level={5} style={{ marginTop: 0 }}>{t('aiConfig.engineMode')}</Title>
            <Form.Item name="engine_mode" style={{ marginBottom: 8 }}>
              <Radio.Group>
                <Radio.Button value="builtin">{t('aiConfig.modeBuiltin')}</Radio.Button>
                <Radio.Button value="local">{t('aiConfig.modeLocal')}</Radio.Button>
                <Radio.Button value="cloud">{t('aiConfig.modeCloud')}</Radio.Button>
              </Radio.Group>
            </Form.Item>
            {engineMode === 'builtin' && (
              <Alert
                style={{ marginBottom: 16 }}
                type="info"
                showIcon
                message={t('aiConfig.builtinHint')}
              />
            )}

            {/* ── Local Model Config ── */}
            {engineMode === 'local' && (
              <>
                <Divider />
                <Title level={5} style={{ marginTop: 0 }}>{t('aiConfig.localConfig')}</Title>

                {/* API Protocol */}
                <Form.Item name="local_api_protocol" label={t('aiConfig.apiProtocol')}>
                  <Radio.Group>
                    <Radio value="openai">OpenAI {t('aiConfig.compatible')}</Radio>
                    <Radio value="claude">Claude {t('aiConfig.compatible')}</Radio>
                  </Radio.Group>
                </Form.Item>

                {/* Local API URL */}
                <Form.Item name="local_api_url" label={t('aiConfig.localApiUrl')}>
                  <Input placeholder="http://localhost:11434/v1" />
                </Form.Item>

                {/* API Key (optional) */}
                <Form.Item label={
                  <Space>
                    <span>{t('aiConfig.apiKey')}</span>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                      ({isZh ? '可选，留空则不传 Authorization 头' : 'Optional, leave empty to skip Authorization header'})
                    </Text>
                  </Space>
                }>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      style={{ flex: 1 }}
                      type={showLocalApiKey ? 'text' : 'password'}
                      placeholder={config?.local_api_key_set
                        ? (config.local_api_key_masked || t('aiConfig.apiKeySet'))
                        : t('aiConfig.apiKeyPlaceholder')
                      }
                      value={localApiKeyInput}
                      onChange={e => setLocalApiKeyInput(e.target.value)}
                    />
                    <Button
                      icon={showLocalApiKey ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                      onClick={() => setShowLocalApiKey(!showLocalApiKey)}
                    />
                  </Space.Compact>
                </Form.Item>

                {/* Model Name (manual input) */}
                <Form.Item name="local_model_name" label={t('aiConfig.localModelName')}>
                  <Input placeholder={t('aiConfig.localModelNamePlaceholder')} />
                </Form.Item>

                {/* Max Tokens */}
                <Form.Item name="local_max_tokens" label={t('aiConfig.maxTokens')}>
                  <InputNumber min={256} max={128000} step={256} style={{ width: 200 }} />
                </Form.Item>

                {/* Temperature */}
                <Form.Item name="local_temperature" label={t('aiConfig.temperature')}>
                  <Slider min={0} max={1} step={0.05} marks={{ 0: '0', 0.3: '0.3', 0.7: '0.7', 1: '1' }} />
                </Form.Item>

                {/* Test Connection */}
                <Form.Item>
                  <Space>
                    <Button
                      icon={testing ? <LoadingOutlined /> : <ApiOutlined />}
                      onClick={handleTest}
                      loading={testing}
                    >
                      {t('aiConfig.localTestConnection')}
                    </Button>
                    {testResult && (
                      <Tag
                        icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                        color={testResult.ok ? 'success' : 'error'}
                      >
                        {testResult.message}
                      </Tag>
                    )}
                  </Space>
                </Form.Item>
              </>
            )}

            {/* ── Cloud LLM Config ── */}
            {engineMode === 'cloud' && (
              <>
                <Divider />
                <Title level={5} style={{ marginTop: 0 }}>{t('aiConfig.cloudConfig')}</Title>

                {/* Platform */}
                <Form.Item name="cloud_platform_name" label={t('aiConfig.platform')}>
                  <Select
                    placeholder={t('aiConfig.platformPlaceholder')}
                    onChange={handlePlatformChange}
                    options={PLATFORM_PRESETS.map(p => ({
                      value: p.name,
                      label: isZh ? p.labelZh : p.labelEn,
                    }))}
                  />
                </Form.Item>

                {/* API Protocol */}
                <Form.Item name="cloud_api_protocol" label={t('aiConfig.apiProtocol')}>
                  <Radio.Group>
                    <Radio value="openai">OpenAI {t('aiConfig.compatible')}</Radio>
                    <Radio value="claude">Claude {t('aiConfig.compatible')}</Radio>
                  </Radio.Group>
                </Form.Item>

                {/* API URL */}
                <Form.Item name="cloud_api_url" label={t('aiConfig.apiUrl')}>
                  <Input placeholder="https://api.example.com/v1" />
                </Form.Item>

                {/* API Key */}
                <Form.Item label={t('aiConfig.apiKey')}>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      style={{ flex: 1 }}
                      type={showCloudApiKey ? 'text' : 'password'}
                      placeholder={config?.cloud_api_key_set
                        ? (config.cloud_api_key_masked || t('aiConfig.apiKeySet'))
                        : t('aiConfig.apiKeyPlaceholder')
                      }
                      value={cloudApiKeyInput}
                      onChange={e => setCloudApiKeyInput(e.target.value)}
                    />
                    <Button
                      icon={showCloudApiKey ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                      onClick={() => setShowCloudApiKey(!showCloudApiKey)}
                    />
                  </Space.Compact>
                  {config?.cloud_api_key_set && !cloudApiKeyInput && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('aiConfig.apiKeyHint')}
                    </Text>
                  )}
                </Form.Item>

                {/* Model Name */}
                <Form.Item name="cloud_model_name" label={t('aiConfig.modelName')}>
                  <Select
                    showSearch
                    allowClear
                    placeholder={t('aiConfig.modelPlaceholder')}
                    options={
                      selectedPlatform?.models.length
                        ? selectedPlatform.models.map(m => ({ value: m, label: m }))
                        : []
                    }
                    mode={undefined}
                    dropdownRender={menu => (
                      <>
                        {menu}
                        <Divider style={{ margin: '4px 0' }} />
                        <Text type="secondary" style={{ padding: '4px 12px', fontSize: 12 }}>
                          {t('aiConfig.modelManualHint')}
                        </Text>
                      </>
                    )}
                  />
                </Form.Item>

                {/* Max Tokens */}
                <Form.Item name="cloud_max_tokens" label={t('aiConfig.maxTokens')}>
                  <InputNumber min={256} max={128000} step={256} style={{ width: 200 }} />
                </Form.Item>

                {/* Temperature */}
                <Form.Item name="cloud_temperature" label={t('aiConfig.temperature')}>
                  <Slider min={0} max={1} step={0.05} marks={{ 0: '0', 0.3: '0.3', 0.7: '0.7', 1: '1' }} />
                </Form.Item>

                {/* Test Connection */}
                <Form.Item>
                  <Space>
                    <Button
                      icon={testing ? <LoadingOutlined /> : <ApiOutlined />}
                      onClick={handleTest}
                      loading={testing}
                    >
                      {t('aiConfig.testConnection')}
                    </Button>
                    {testResult && (
                      <Tag
                        icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                        color={testResult.ok ? 'success' : 'error'}
                      >
                        {testResult.message}
                      </Tag>
                    )}
                  </Space>
                </Form.Item>
              </>
            )}

            <Divider />

            {/* ── Feature Switches ── */}
            <Title level={5} style={{ marginTop: 0 }}>{t('aiConfig.featureSwitches')}</Title>
            {FEATURE_KEYS.map(f => (
              <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Text>{isZh ? f.zhLabel : f.enLabel}</Text>
                <Switch
                  checked={config?.feature_flags?.[f.key] ?? true}
                  onChange={(checked) => handleFeatureToggle(f.key, checked)}
                />
              </div>
            ))}

            {/* ── AI Validate Config (v3.0) ── */}
            {config?.feature_flags?.data_validate && validateConfig && (
              <>
                <Divider />
                <Title level={5} style={{ marginTop: 0 }}>
                  <Space>
                    <SafetyCertificateOutlined />
                    {isZh ? '智能校验配置' : 'Smart Validation Config'}
                  </Space>
                </Title>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Outlier range */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text strong>{isZh ? '异常值检测范围' : 'Outlier Detection Range'}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {isZh ? '超出此分位数范围标警告' : 'Values outside this percentile range trigger warnings'}
                      </Text>
                    </div>
                    <Radio.Group
                      value={validateConfig.outlier_range}
                      onChange={async (e) => {
                        try {
                          const res = await updateAIValidateConfig({ outlier_range: e.target.value });
                          setValidateConfig(res.data);
                        } catch { /* ignore */ }
                      }}
                    >
                      <Radio.Button value="p1_p99">P1-P99</Radio.Button>
                      <Radio.Button value="p5_p95">P5-P95</Radio.Button>
                      <Radio.Button value="p10_p90">P10-P90</Radio.Button>
                    </Radio.Group>
                  </div>

                  <Divider style={{ margin: '4px 0' }} />

                  {/* History sample size */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text strong>{isZh ? '历史采样量' : 'History Sample Size'}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {isZh ? '用于统计分析的历史数据采样条数' : 'Number of historical records to sample for analysis'}
                      </Text>
                    </div>
                    <InputNumber
                      min={100}
                      max={10000}
                      step={100}
                      value={validateConfig.history_sample_size}
                      onChange={async (val) => {
                        if (val) {
                          try {
                            const res = await updateAIValidateConfig({ history_sample_size: val });
                            setValidateConfig(res.data);
                          } catch { /* ignore */ }
                        }
                      }}
                      style={{ width: 140 }}
                    />
                  </div>

                  <Divider style={{ margin: '4px 0' }} />

                  {/* Warning behavior */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text strong>{isZh ? '警告行为' : 'Warning Behavior'}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {isZh ? 'AI 警告是否阻断导入' : 'Whether AI warnings block import'}
                      </Text>
                    </div>
                    <Radio.Group
                      value={validateConfig.warning_behavior}
                      onChange={async (e) => {
                        try {
                          const res = await updateAIValidateConfig({ warning_behavior: e.target.value });
                          setValidateConfig(res.data);
                        } catch { /* ignore */ }
                      }}
                    >
                      <Radio.Button value="warn">{isZh ? '仅提醒' : 'Warn only'}</Radio.Button>
                      <Radio.Button value="block">{isZh ? '阻断导入' : 'Block import'}</Radio.Button>
                    </Radio.Group>
                  </div>

                  <Divider style={{ margin: '4px 0' }} />

                  {/* Skip fields */}
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <Text strong>{isZh ? '跳过字段' : 'Skip Fields'}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {isZh ? '指定不参与智能校验的字段名（逗号分隔）' : 'Field names to exclude from smart validation (comma separated)'}
                      </Text>
                    </div>
                    <Select
                      mode="tags"
                      style={{ width: '100%' }}
                      placeholder={isZh ? '输入字段名后回车添加' : 'Type field name and press Enter'}
                      value={validateConfig.skip_fields}
                      onChange={async (vals) => {
                        try {
                          const res = await updateAIValidateConfig({ skip_fields: vals });
                          setValidateConfig(res.data);
                        } catch { /* ignore */ }
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <Divider />

        {/* ── Action Buttons ── */}
        <Space>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            {t('aiConfig.saveConfig')}
          </Button>
          <Button icon={<UndoOutlined />} onClick={handleReset}>
            {t('aiConfig.resetConfig')}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
