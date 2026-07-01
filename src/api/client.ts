import axios, { type AxiosError } from 'axios';
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

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const requestUrl = error.config?.url ?? '';
    const shouldBroadcastUnauthorized =
      error.response?.status === 401 &&
      requestUrl !== API_CONFIG.endpoints.loginStart &&
      requestUrl !== API_CONFIG.endpoints.loginStatus &&
      requestUrl !== API_CONFIG.endpoints.session;

    if (shouldBroadcastUnauthorized && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openstroid:unauthorized'));
    }

    return Promise.reject(error);
  },
);
