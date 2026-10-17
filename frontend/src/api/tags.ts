import { http } from './client';
import type { Tag } from './types';

export interface TagInput {
  name?: string;
  color?: string;
  iteration_id?: string | null;
  description?: string;
}

export async function getTagsByTeam(teamId: string): Promise<Tag[]> {
  const { data } = await http.get<Tag[]>(`/api/teams/${teamId}/tags`);
  return data;
}

export async function getAllTags(): Promise<Tag[]> {
  const { data } = await http.get<Tag[]>('/api/tags');
  return data;
}

export async function createTag(teamId: string, input: Required<Pick<TagInput, 'name'>> & TagInput): Promise<Tag> {
  const { data } = await http.post<Tag>(`/api/teams/${teamId}/tags`, input);
  return data;
}

export async function updateTag(id: string, input: TagInput): Promise<Tag> {
  const { data } = await http.patch<Tag>(`/api/tags/${id}`, input);
  return data;
}

export async function deleteTag(id: string): Promise<void> {
  await http.delete(`/api/tags/${id}`);
}
