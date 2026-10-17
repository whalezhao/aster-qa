import { http } from './client';
import type { Project } from './types';

export interface ProjectInput {
  name?: string;
  code?: string;
  description?: string;
  base_url?: string;
}

export async function getProjects(teamId: string): Promise<Project[]> {
  const { data } = await http.get<Project[]>(`/api/teams/${teamId}/projects`);
  return data;
}

export async function createProject(teamId: string, input: Required<Pick<ProjectInput, 'name'>> & ProjectInput): Promise<Project> {
  const { data } = await http.post<Project>(`/api/teams/${teamId}/projects`, input);
  return data;
}

export async function getProject(id: string): Promise<Project> {
  const { data } = await http.get<Project>(`/api/projects/${id}`);
  return data;
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const { data } = await http.patch<Project>(`/api/projects/${id}`, input);
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  await http.delete(`/api/projects/${id}`);
}

// ------------------------------------------------------ 项目级模型配置
// 注意：后端**永远不会**返回 api_key 本身，只给 api_key_set 表示配没配。

export interface ModelConfig {
  /** 必填项齐全；false 表示该项目还不能执行 */
  configured: boolean;
  /** 还缺哪些必填项的中文名，界面直接展示「差什么」 */
  missing: string[];
  model_name: string | null;
  model_family: string | null;
  base_url: string | null;
  init_config_json: string | null;
  api_key_set: boolean;
  /** null = 跟随全局 */
  reasoning_enabled: boolean | null;
  /** 每月 token 限额；null/0 = 不限 */
  token_quota: number | null;
  /** 本月已用（执行器 + 平台侧 AI 调用） */
  month_tokens_used: number;
}

export interface ModelConfigInput {
  model_name?: string;
  model_family?: string;
  base_url?: string;
  init_config_json?: string;
  /** 留空表示保持现有密钥不变 */
  api_key?: string;
  /** 显式清除已存的密钥 */
  clear_api_key?: boolean;
  reasoning_enabled?: boolean;
  /** 恢复成「跟随全局」 */
  clear_reasoning?: boolean;
  /** 每月 token 限额；0/不传 = 不改 */
  token_quota?: number;
  /** 显式清除限额 */
  clear_token_quota?: boolean;
}

export async function getModelConfig(projectId: string): Promise<ModelConfig> {
  const { data } = await http.get<ModelConfig>(`/api/projects/${projectId}/model-config`);
  return data;
}

export async function setModelConfig(
  projectId: string,
  input: ModelConfigInput,
): Promise<ModelConfig> {
  const { data } = await http.put<ModelConfig>(`/api/projects/${projectId}/model-config`, input);
  return data;
}

export async function clearModelConfig(projectId: string): Promise<void> {
  await http.delete(`/api/projects/${projectId}/model-config`);
}
