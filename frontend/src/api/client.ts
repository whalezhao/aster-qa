import axios from 'axios';
import type { ApiErrorBody } from './types';

export const TOKEN_KEY = 'qa_token';

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

export const http = axios.create({
  baseURL: API_BASE,
});

/**
 * 把后端返回的相对路径（报告地址等）拼成绝对地址。
 * iframe / img 的 src 不会走 axios，相对路径会被解析到前端 origin 上，必须自己拼。
 */
export function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

/** 把后端错误统一转成可展示的中文字符串。detail 可能是字符串，也可能是 422 的对象数组。 */
export function apiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          const field = item.loc.filter((p) => p !== 'body').join('.');
          return field ? `${field}: ${item.msg}` : item.msg;
        })
        .join('；');
    }
    return error.message;
  }
  return String(error);
}
