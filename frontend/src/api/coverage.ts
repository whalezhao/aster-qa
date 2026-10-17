import { http } from './client';
import type { CoverageResult } from './types';

export interface CoverageParams {
  team_id?: string;
  project_id?: string;
  iteration_id?: string;
}

export async function getRequirementCoverage(
  params: CoverageParams,
): Promise<CoverageResult> {
  const { data } = await http.get<CoverageResult>('/api/stats/requirement-coverage', {
    params,
  });
  return data;
}
