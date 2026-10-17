import { http } from './client';
import type { Iteration, IterationStatus } from './types';

export interface IterationInput {
  name?: string;
  version?: string;
  status?: IterationStatus;
  start_date?: string;
  end_date?: string;
}

export async function getIterationsByTeam(teamId: string): Promise<Iteration[]> {
  const { data } = await http.get<Iteration[]>(`/api/teams/${teamId}/iterations`);
  return data;
}

export async function getAllIterations(): Promise<Iteration[]> {
  const { data } = await http.get<Iteration[]>('/api/iterations');
  return data;
}

export async function createIteration(teamId: string, input: Required<Pick<IterationInput, 'name'>> & IterationInput): Promise<Iteration> {
  const { data } = await http.post<Iteration>(`/api/teams/${teamId}/iterations`, input);
  return data;
}

export async function updateIteration(id: string, input: IterationInput): Promise<Iteration> {
  const { data } = await http.patch<Iteration>(`/api/iterations/${id}`, input);
  return data;
}

export async function deleteIteration(id: string): Promise<void> {
  await http.delete(`/api/iterations/${id}`);
}
