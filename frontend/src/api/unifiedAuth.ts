import { api } from './request';

export interface VerifyResponse {
  valid: boolean;
  account_id: string;
  expires_at: string | null;
  mode?: 'online' | 'offline';
}

export interface LicenseCheckResponse {
  product: string;
  plugin: string;
  licensed: boolean;
  expires_at: string | null;
}

export async function fetchWechatRedirectUrl(): Promise<string> {
  const res = await api.get('/auth/wechat/redirect-url');
  return res.data.redirect_url;
}

export async function verifyTokenOnline(token: string): Promise<VerifyResponse> {
  const res = await api.get('/auth/verify', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function verifyTokenOffline(token: string): Promise<VerifyResponse> {
  const res = await api.get('/auth/offline-verify', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function refreshPublicKey(): Promise<void> {
  await api.post('/auth/public-key/refresh');
}

export async function checkPluginLicense(plugin: string): Promise<LicenseCheckResponse> {
  const res = await api.get('/license/check', { params: { plugin } });
  return res.data;
}
