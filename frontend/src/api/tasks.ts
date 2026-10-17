import { http } from './client';
import type { Task, TaskCase, TaskSignoff, TaskTag, TaskType } from './types';

export interface TaskInput {
  name?: string;
  type?: TaskType;
  description?: string;
  project_id?: string | null;
  iteration_id?: string | null;
  retry_count?: number;
  /** 建任务时直接选功能 —— 一个任务就是一堆功能的组合 */
  feature_ids?: string[];
  tag_ids?: string[];
  run_now?: boolean;
}

/** 建任务的返回：任务本体 + 本次快照了多少用例/功能，以及触发了哪些执行。 */
export interface CreateTaskResult extends Task {
  case_count: number;
  feature_count: number;
  batch_id: string | null;
  run_ids: string[];
}

export interface TaskListParams {
  project_id?: string;
  /** 按分期筛：任务里只要有该分期的用例就算命中 */
  stage?: 'in_iteration' | 'released';
  status?: string;
  name?: string;
}

export async function getTasks(teamId: string, params: TaskListParams = {}): Promise<Task[]> {
  const { data } = await http.get<Task[]>(`/api/teams/${teamId}/tasks`, { params });
  return data;
}

export async function getAllTasks(): Promise<Task[]> {
  const { data } = await http.get<Task[]>('/api/tasks');
  return data;
}

export async function createTask(
  teamId: string,
  input: Required<Pick<TaskInput, 'name'>> & TaskInput,
): Promise<CreateTaskResult> {
  const { data } = await http.post<CreateTaskResult>(`/api/teams/${teamId}/tasks`, input);
  return data;
}

export async function getTask(id: string): Promise<Task> {
  const { data } = await http.get<Task>(`/api/tasks/${id}`);
  return data;
}

export async function updateTask(id: string, input: TaskInput): Promise<Task> {
  const { data } = await http.patch<Task>(`/api/tasks/${id}`, input);
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  await http.delete(`/api/tasks/${id}`);
}

export interface BulkDeleteResult {
  deleted: number;
  skipped: { id: string; name: string; reason: string }[];
}

/** 批量删任务，连带删掉它们的执行记录（报告一并清掉）。 */
export async function deleteTasks(ids: string[]): Promise<BulkDeleteResult> {
  const { data } = await http.post<BulkDeleteResult>('/api/tasks/bulk-delete', {
    task_ids: ids,
  });
  return data;
}

export async function getTaskCases(id: string): Promise<TaskCase[]> {
  const { data } = await http.get<TaskCase[]>(`/api/tasks/${id}/cases`);
  return data;
}

export async function setTaskCases(id: string, case_ids: string[]): Promise<{ count: number }> {
  const { data } = await http.put<{ count: number }>(`/api/tasks/${id}/cases`, { case_ids });
  return data;
}

export async function getTaskTags(id: string): Promise<TaskTag[]> {
  const { data } = await http.get<TaskTag[]>(`/api/tasks/${id}/tags`);
  return data;
}

export async function setTaskTags(id: string, tag_ids: string[]): Promise<{ count: number }> {
  const { data } = await http.put<{ count: number }>(`/api/tasks/${id}/tags`, { tag_ids });
  return data;
}

export async function setTaskFeatures(id: string, feature_ids: string[]): Promise<{ count: number }> {
  const { data } = await http.put<{ count: number }>(`/api/tasks/${id}/features`, { feature_ids });
  return data;
}

export async function runTask(
  id: string,
): Promise<{ task_id: string; batch_id: string; run_ids: string[] }> {
  const { data } = await http.post<{ task_id: string; batch_id: string; run_ids: string[] }>(
    `/api/tasks/${id}/run`,
  );
  return data;
}

export interface TaskFeature {
  id: string;
  name: string;
  stage: 'in_iteration' | 'released';
  project_id: string;
  project_name: string;
}

export async function getTaskFeatures(id: string): Promise<TaskFeature[]> {
  const { data } = await http.get<TaskFeature[]>(`/api/tasks/${id}/features`);
  return data;
}

// ------------------------------------------------------------------------- 人工签名

export async function getTaskSignoff(taskId: string): Promise<TaskSignoff> {
  const { data } = await http.get<TaskSignoff>(`/api/tasks/${taskId}/signoff`);
  return data;
}

export async function signTask(taskId: string, note?: string): Promise<TaskSignoff> {
  const { data } = await http.post<TaskSignoff>(`/api/tasks/${taskId}/signoff`, { note });
  return data;
}

export async function revokeTaskSignoff(taskId: string): Promise<TaskSignoff> {
  const { data } = await http.post<TaskSignoff>(`/api/tasks/${taskId}/signoff/revoke`);
  return data;
}
