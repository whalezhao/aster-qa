import { http } from './client';
import type { Environment, EnvironmentVariableInput } from './types';

export async function getProjectEnvironments(projectId: string): Promise<Environment[]> {
  const { data } = await http.get<Environment[]>(`/api/projects/${projectId}/environments`);
  return data;
}

/** 测试团队下所有系统的环境（新建/编辑任务时选环境名用）。 */
export async function getTeamEnvironments(teamId: string): Promise<Environment[]> {
  const { data } = await http.get<Environment[]>(`/api/teams/${teamId}/environments`);
  return data;
}

export async function createEnvironment(
  projectId: string,
  input: { name: string; base_url?: string | null },
): Promise<Environment> {
  const { data } = await http.post<Environment>(
    `/api/projects/${projectId}/environments`,
    input,
  );
  return data;
}

export async function updateEnvironment(
  id: string,
  input: { name?: string; base_url?: string | null },
): Promise<Environment> {
  const { data } = await http.patch<Environment>(`/api/environments/${id}`, input);
  return data;
}

export async function deleteEnvironment(id: string): Promise<void> {
  await http.delete(`/api/environments/${id}`);
}

export async function setEnvironmentVariables(
  id: string,
  variables: EnvironmentVariableInput[],
): Promise<Environment> {
  const { data } = await http.put<Environment>(`/api/environments/${id}/variables`, {
    variables,
  });
  return data;
}
