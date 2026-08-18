import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-Device-Id'] = 'web-portal';
  return config;
});

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retried) {
      error.config._retried = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw error;

      refreshing ??= axios
        .post('/api/auth/refresh', { refreshToken })
        .then((r) => {
          localStorage.setItem('accessToken', r.data.access);
          localStorage.setItem('refreshToken', r.data.refresh);
          return r.data.access as string;
        })
        .finally(() => {
          refreshing = null;
        });

      const newToken = await refreshing;
      error.config.headers.Authorization = `Bearer ${newToken}`;
      return api.request(error.config);
    }
    throw error;
  },
);
