import { useEffect, useState } from 'react';
import { Card, Input, Form, Alert, message, Button } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, GithubOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/request';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, authReady, login } = useAuth();
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<{ captcha_id: string; image: string } | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (authReady && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [authReady, isAuthenticated, navigate]);

  const loadCaptcha = async () => {
    try {
      const res = await api.get('/auth/captcha');
      setCaptcha(res.data);
      form.setFieldValue('captcha_code', '');
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  const handleLogin = async (values: { username: string; password: string; captcha_code: string }) => {
    if (!captcha) return;
    setLoginLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login', {
        username: values.username,
        password: values.password,
        captcha_id: captcha.captcha_id,
        captcha_code: values.captcha_code,
      });
      const { token, username, role, display_name } = res.data;
      login(token, {
        username,
        role,
        display_name,
        auth_source: '本地账号',
      });
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(detail || '登录失败，请检查账号密码');
      loadCaptcha();
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg, #0B1530 0%, #142952 50%, #0A234A 100%)', backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)', backgroundSize: '40px 40px' }}>
      <Card style={{ width: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', borderRadius: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/logo.png" alt="DataOps Workbench" style={{ height: 96 }} />
        </div>

        {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} closable onClose={() => setError(null)} />}

        <Form form={form} onFinish={handleLogin} size="large" autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="admin" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="dalimaoya" />
          </Form.Item>
          <Form.Item>
            <div style={{ display: 'flex', gap: 8 }}>
              <Form.Item name="captcha_code" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                <Input prefix={<SafetyCertificateOutlined />} placeholder="验证码" />
              </Form.Item>
              {captcha && (
                <img
                  src={`data:image/png;base64,${captcha.image}`}
                  alt="captcha"
                  onClick={loadCaptcha}
                  style={{ height: 40, cursor: 'pointer', borderRadius: 6, border: '1px solid #d9d9d9', flexShrink: 0 }}
                  title="点击刷新验证码"
                />
              )}
            </div>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loginLoading} block style={{ height: 46, borderRadius: 10 }}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Footer Links */}
      <div style={{ marginTop: 24, display: 'flex', gap: 24, alignItems: 'center' }}>
        <a
          href="https://github.com/dalimaoya/data-ops-workbench"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <GithubOutlined style={{ fontSize: 16 }} /> GitHub
        </a>
        <a
          href="https://gitee.com/dalimaoya/data-ops-workbench"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
            <path d="M512 1024C229.222 1024 0 794.778 0 512S229.222 0 512 0s512 229.222 512 512-229.222 512-512 512z m259.149-568.883h-290.74a25.293 25.293 0 0 0-25.292 25.293l-0.026 63.206c0 13.952 11.315 25.293 25.267 25.293h177.024c13.978 0 25.293 11.315 25.293 25.267v12.646a75.853 75.853 0 0 1-75.853 75.853h-240.23a25.293 25.293 0 0 1-25.267-25.293V417.203a75.853 75.853 0 0 1 75.827-75.853h353.946a25.293 25.293 0 0 0 25.267-25.292l0.077-63.207a25.293 25.293 0 0 0-25.268-25.293H417.152a189.62 189.62 0 0 0-189.62 189.645V771.15c0 13.977 11.316 25.293 25.294 25.293h372.94a170.65 170.65 0 0 0 170.65-170.65V480.384a25.293 25.293 0 0 0-25.293-25.267z" />
          </svg>
          Gitee
        </a>
      </div>
    </div>
  );
}
