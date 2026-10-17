import { http } from './client';
import type {
  StatsBreakdown,
  StatsCost,
  StatsFailure,
  StatsFlaky,
  StatsOverview,
  StatsRegressionRow,
  StatsTrendPoint,
} from './types';

export interface StatsScopeParams {
  team_id?: string;
  project_id?: string;
  iteration_id?: string;
  date_from?: string;
  date_to?: string;
}

export async function getStatsOverview(params: StatsScopeParams): Promise<StatsOverview> {
  const { data } = await http.get<StatsOverview>('/api/stats/overview', { params });
  return data;
}

export async function getStatsBreakdown(params: StatsScopeParams): Promise<StatsBreakdown> {
  const { data } = await http.get<StatsBreakdown>('/api/stats/breakdown', { params });
  return data;
}

export async function getStatsTrend(
  params: StatsScopeParams & { bucket: 'day' | 'iteration'; days?: number },
): Promise<StatsTrendPoint[]> {
  const { data } = await http.get<StatsTrendPoint[]>('/api/stats/trend', { params });
  return data;
}

export async function getStatsFailures(
  params: StatsScopeParams & { days?: number; limit?: number },
): Promise<StatsFailure[]> {
  const { data } = await http.get<StatsFailure[]>('/api/stats/failures', { params });
  return data;
}

export async function getStatsFlaky(params: {
  team_id?: string;
  project_id?: string;
  limit?: number;
}): Promise<StatsFlaky[]> {
  const { data } = await http.get<StatsFlaky[]>('/api/stats/flaky', { params });
  return data;
}

export async function getStatsCost(params: {
  team_id?: string;
  project_id?: string;
  days?: number;
}): Promise<StatsCost> {
  const { data } = await http.get<StatsCost>('/api/stats/cost', { params });
  return data;
}

export async function getStatsRegression(params: {
  team_id?: string;
  iteration_id?: string;
}): Promise<StatsRegressionRow[]> {
  const { data } = await http.get<StatsRegressionRow[]>('/api/stats/regression', { params });
  return data;
}
