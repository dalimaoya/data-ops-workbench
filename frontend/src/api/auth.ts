import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export interface LoginRequest {
  username: string;
  password: string;
  captcha_id: string;
  captcha_code: string;
}

export interface LoginResponse {
  token: string;
  username: string;
  role: string;
  display_name: string | null;
}

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  display_name: string | null;
  status: string;
}

export interface CaptchaResponse {
  captcha_id: string;
  image: string; // base64 png
}

export const login = (data: LoginRequest) =>
  api.post<LoginResponse>('/auth/login', data);

export const getMe = (token: string) =>
  api.get<UserInfo>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });

export const getCaptcha = () =>
  api.get<CaptchaResponse>('/auth/captcha');
