import { http } from './client';
import type { BulkReleaseResult, Feature, FeatureStage } from './types';

export interface FeatureInput {
  name?: string;
  description?: string;
  requirement_ids?: string | null;
  iteration_id?: string | null;
  stage?: FeatureStage;
}

export async function getFeatures(projectId: string, stage?: FeatureStage): Promise<Feature[]> {
  const { data } = await http.get<Feature[]>(`/api/projects/${projectId}/features`, {
    params: stage ? { stage } : undefined,
  });
  return data;
}

export async function createFeature(
  projectId: string,
  input: Required<Pick<FeatureInput, 'name'>> & FeatureInput,
): Promise<Feature> {
  const { data } = await http.post<Feature>(`/api/projects/${projectId}/features`, input);
  return data;
}

export async function getFeature(id: string): Promise<Feature> {
  const { data } = await http.get<Feature>(`/api/features/${id}`);
  return data;
}

export async function updateFeature(id: string, input: FeatureInput): Promise<Feature> {
  const { data } = await http.patch<Feature>(`/api/features/${id}`, input);
  return data;
}

export async function deleteFeature(id: string): Promise<void> {
  await http.delete(`/api/features/${id}`);
}

export async function releaseFeature(id: string, cascade: boolean): Promise<Feature> {
  const { data } = await http.post<Feature>(`/api/features/${id}/release`, { cascade });
  return data;
}

export async function reopenFeature(id: string): Promise<Feature> {
  const { data } = await http.post<Feature>(`/api/features/${id}/reopen`);
  return data;
}

export async function bulkReleaseFeatures(ids: string[], cascade: boolean): Promise<BulkReleaseResult> {
  const { data } = await http.post<BulkReleaseResult>('/api/features/bulk-release', { ids }, { params: { cascade } });
  return data;
}

export async function getCaseCounts(projectId: string): Promise<Record<string, number>> {
  const { data } = await http.get<Record<string, number>>(`/api/projects/${projectId}/features/case-counts`);
  return data;
}
