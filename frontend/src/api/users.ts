import { http } from './client';
import type { User } from './types';

export interface UserCreateInput {
  username: string;
  password: string;
  email?: string;
  display_name?: string;
  avatar?: string | null;
}

export interface UserUpdateInput {
  /** 传 null 表示清空该字段 */
  email?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  is_active?: boolean;
  password?: string;
}

export async function getUsers(withTeams = false): Promise<User[]> {
  const { data } = await http.get<User[]>('/api/users', {
    params: withTeams ? { with_teams: true } : undefined,
  });
  return data;
}

export async function createUser(input: UserCreateInput): Promise<User> {
  const { data } = await http.post<User>('/api/users', input);
  return data;
}

export async function updateUser(id: string, input: UserUpdateInput): Promise<User> {
  const { data } = await http.patch<User>(`/api/users/${id}`, input);
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await http.delete(`/api/users/${id}`);
}
