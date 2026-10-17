import { http } from './client';
import type { ApiToken, ApiTokenCreated } from './types';

export async function getApiTokens(teamId: string): Promise<ApiToken[]> {
  const { data } = await http.get<ApiToken[]>(`/api/teams/${teamId}/api-tokens`);
  return data;
}

export async function createApiToken(
  teamId: string,
  input: { name: string; scopes: string[]; expires_at?: string | null },
): Promise<ApiTokenCreated> {
  const { data } = await http.post<ApiTokenCreated>(
    `/api/teams/${teamId}/api-tokens`,
    input,
  );
  return data;
}

export async function revokeApiToken(teamId: string, tokenId: string): Promise<void> {
  await http.delete(`/api/teams/${teamId}/api-tokens/${tokenId}`);
}
