import { http } from './client';
import type { Role, Team, TeamMember } from './types';

export interface TeamInput {
  name?: string;
  description?: string;
}

export async function getTeams(): Promise<Team[]> {
  const { data } = await http.get<Team[]>('/api/teams');
  return data;
}

export async function createTeam(input: Required<Pick<TeamInput, 'name'>> & TeamInput): Promise<Team> {
  const { data } = await http.post<Team>('/api/teams', input);
  return data;
}

export async function getTeam(id: string): Promise<Team> {
  const { data } = await http.get<Team>(`/api/teams/${id}`);
  return data;
}

export async function updateTeam(id: string, input: TeamInput): Promise<Team> {
  const { data } = await http.patch<Team>(`/api/teams/${id}`, input);
  return data;
}

export async function deleteTeam(id: string): Promise<void> {
  await http.delete(`/api/teams/${id}`);
}

export async function getMembers(teamId: string): Promise<TeamMember[]> {
  const { data } = await http.get<TeamMember[]>(`/api/teams/${teamId}/members`);
  return data;
}

export async function addMember(teamId: string, user_id: string, role: Role): Promise<TeamMember> {
  const { data } = await http.post<TeamMember>(`/api/teams/${teamId}/members`, { user_id, role });
  return data;
}

export async function updateMemberRole(teamId: string, userId: string, role: Role): Promise<TeamMember> {
  const { data } = await http.patch<TeamMember>(`/api/teams/${teamId}/members/${userId}`, { role });
  return data;
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await http.delete(`/api/teams/${teamId}/members/${userId}`);
}
