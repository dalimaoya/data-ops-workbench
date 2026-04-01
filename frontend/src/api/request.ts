import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 30000 });

// Request interceptor: attach JWT token and Accept-Language header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Send current i18n language as Accept-Language for backend i18n
  const lang = localStorage.getItem('i18n-lang') || 'zh';
  config.headers['Accept-Language'] = lang === 'en' ? 'en' : 'zh';
  return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('unified-auth-session');
      localStorage.removeItem('unified-auth-license-cache');
      // Redirect to login
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
