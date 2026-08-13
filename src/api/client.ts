import axios, { type AxiosError } from 'axios';
import { readSessionHandoff } from '../auth/storage';
import { API_CONFIG } from './config';

export const apiClient = axios.create({
  baseURL: API_CONFIG.baseUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 15000,
});

apiClient.interceptors.request.use(async (config) => {
  const handoff = await readSessionHandoff();
  if (handoff) {
    config.headers.set('X-OpenStroid-Session', handoff);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const requestUrl = error.config?.url ?? '';
    const isLoginStatusRequest =
      requestUrl === API_CONFIG.endpoints.qrLoginStatus ||
      requestUrl.startsWith(`${API_CONFIG.endpoints.qrLoginStatus}/`);
    const shouldBroadcastUnauthorized =
      error.response?.status === 401 &&
      requestUrl !== API_CONFIG.endpoints.qrLoginStart &&
      !isLoginStatusRequest &&
      requestUrl !== API_CONFIG.endpoints.session;

    if (shouldBroadcastUnauthorized && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openstroid:unauthorized'));
    }

    return Promise.reject(error);
  },
);
