import { http } from './client';
import type { CurrentUser, TokenResponse } from './types';

export async function login(username: string, password: string): Promise<TokenResponse> {
  const { data } = await http.post<TokenResponse>('/api/auth/login', { username, password });
  return data;
}

export async function logout(): Promise<void> {
  await http.post('/api/auth/logout');
}

export async function getMe(): Promise<CurrentUser> {
  const { data } = await http.get<CurrentUser>('/api/auth/me');
  return data;
}

export async function changePassword(old_password: string, new_password: string): Promise<void> {
  await http.post('/api/auth/change-password', { old_password, new_password });
}
