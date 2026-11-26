import { http } from './client';
import type {
  DataSourceTestResult,
  EnvironmentDataSource,
  EnvironmentDataSourceInput,
  ProjectDataSource,
} from './types';

export async function getProjectDataSources(
  projectId: string,
): Promise<ProjectDataSource[]> {
  const { data } = await http.get<ProjectDataSource[]>(
    `/api/projects/${projectId}/datasources`,
  );
  return data;
}

export async function getEnvironmentDataSources(
  environmentId: string,
): Promise<EnvironmentDataSource[]> {
  const { data } = await http.get<EnvironmentDataSource[]>(
    `/api/environments/${environmentId}/datasources`,
  );
  return data;
}

export async function createEnvironmentDataSource(
  environmentId: string,
  input: EnvironmentDataSourceInput,
): Promise<EnvironmentDataSource> {
  const { data } = await http.post<EnvironmentDataSource>(
    `/api/environments/${environmentId}/datasources`,
    input,
  );
  return data;
}

export async function updateEnvironmentDataSource(
  environmentId: string,
  id: string,
  input: EnvironmentDataSourceInput,
): Promise<EnvironmentDataSource> {
  const { data } = await http.put<EnvironmentDataSource>(
    `/api/environments/${environmentId}/datasources/${id}`,
    input,
  );
  return data;
}

export async function deleteEnvironmentDataSource(
  environmentId: string,
  id: string,
): Promise<void> {
  await http.delete(`/api/environments/${environmentId}/datasources/${id}`);
}

export async function testEnvironmentDataSource(
  environmentId: string,
  input: EnvironmentDataSourceInput & { id?: string },
): Promise<DataSourceTestResult> {
  const { data } = await http.post<DataSourceTestResult>(
    `/api/environments/${environmentId}/datasources/test`,
    input,
  );
  return data;
}