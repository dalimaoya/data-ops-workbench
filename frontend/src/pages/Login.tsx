import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, message, Space } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined, GithubOutlined, LinkOutlined } from '@ant-design/icons';
import { login as loginApi, getCaptcha } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await getCaptcha();
      setCaptchaId(res.data.captcha_id);
      setCaptchaImage(res.data.image);
    } catch {
      message.error(t('login.captchaFailed'));
    } finally {
      setCaptchaLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refreshCaptcha();
  }, [refreshCaptcha]);

  const onFinish = async (values: { username: string; password: string; captcha_code: string }) => {
    setLoading(true);
    try {
      const res = await loginApi({
        username: values.username,
        password: values.password,
        captcha_id: captchaId,
        captcha_code: values.captcha_code,
      });
      const data = res.data;
      login(data.token, {
        username: data.username,
        role: data.role,
        display_name: data.display_name,
      });
      message.success(t('login.loginSuccess'));
      navigate('/', { replace: true });
    } catch (err: any) {
      const msg = err.response?.data?.detail || t('login.loginFailed');
      message.error(msg);
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          borderRadius: 12,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/logo.png" alt="DataOps Workbench" style={{ height: 94, marginBottom: 12 }} />
        </div>
        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: t('login.usernameRequired') }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={t('login.usernamePlaceholder')}
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.passwordRequired') }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('login.passwordPlaceholder')}
            />
          </Form.Item>
          <Form.Item>
            <div style={{ display: 'flex', gap: 8 }}>
              <Form.Item
                name="captcha_code"
                noStyle
                rules={[{ required: true, message: t('login.captchaRequired') }]}
              >
                <Input
                  prefix={<SafetyOutlined />}
                  placeholder={t('login.captchaPlaceholder')}
                  maxLength={4}
                  style={{ flex: 1 }}
                />
              </Form.Item>
              <img
                src={captchaImage ? `data:image/png;base64,${captchaImage}` : ''}
                alt={t('login.captcha')}
                onClick={refreshCaptcha}
                style={{
                  height: 40,
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: '1px solid #d9d9d9',
                  opacity: captchaLoading ? 0.5 : 1,
                  minWidth: 130,
                  objectFit: 'contain',
                  background: '#fafafa',
                }}
                title={t('login.captchaRefresh')}
              />
            </div>
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ height: 44, borderRadius: 8 }}
            >
              {t('login.login')}
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Space size={16}>
            <a href="https://github.com/dalimaoya/data-ops-workbench" target="_blank" rel="noopener noreferrer"
               style={{ color: '#999', fontSize: 20 }} title="GitHub">
              <GithubOutlined />
            </a>
            <a href="https://gitee.com/dalimaoya/data-ops-workbench" target="_blank" rel="noopener noreferrer"
               style={{ color: '#999', fontSize: 20 }} title="Gitee">
              <LinkOutlined />
            </a>
          </Space>
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, color: '#bbb', fontSize: 12 }}>
          {t('login.copyright', { year: new Date().getFullYear() })}
        </div>
      </Card>
    </div>
  );
}
