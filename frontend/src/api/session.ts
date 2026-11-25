import { http } from './client';
import type { SessionConfig, SessionConfigInput } from './types';

export async function getEnvironmentSessionConfig(
  environmentId: string,
): Promise<SessionConfig> {
  const { data } = await http.get<SessionConfig>(
    `/api/environments/${environmentId}/session-config`,
  );
  return data;
}

export async function setEnvironmentSessionConfig(
  environmentId: string,
  input: SessionConfigInput,
): Promise<SessionConfig> {
  const { data } = await http.put<SessionConfig>(
    `/api/environments/${environmentId}/session-config`,
    input,
  );
  return data;
}

export async function clearEnvironmentSessionState(
  environmentId: string,
): Promise<void> {
  await http.delete(`/api/environments/${environmentId}/session-state`);
}