import { http } from './client';
import type { RunCase, RunDetail, RunListResponse, RunStatus } from './types';

export interface RunListParams {
  team_id?: string;
  project_id?: string;
  task_id?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

export async function getRuns(params: RunListParams): Promise<RunListResponse> {
  const { data } = await http.get<RunListResponse>('/api/runs', { params });
  return data;
}

export async function getRun(id: string): Promise<RunDetail> {
  const { data } = await http.get<RunDetail>(`/api/runs/${id}`);
  return data;
}

export async function getRunCases(id: string): Promise<RunCase[]> {
  const { data } = await http.get<RunCase[]>(`/api/runs/${id}/cases`);
  return data;
}

export async function cancelRun(id: string): Promise<{ status: string }> {
  const { data } = await http.post<{ status: string }>(`/api/runs/${id}/cancel`);
  return data;
}

export async function reparseRun(id: string): Promise<{ cases: number; ai_calls: number }> {
  const { data } = await http.post<{ cases: number; ai_calls: number }>(`/api/runs/${id}/reparse`);
  return data;
}

/** 只重跑这次 run 里失败用例；返回新批次。 */
export async function rerunFailedRun(
  id: string,
): Promise<{ batch_id: string; run_ids: string[]; case_count: number }> {
  const { data } = await http.post<{
    batch_id: string;
    run_ids: string[];
    case_count: number;
  }>(`/api/runs/${id}/rerun-failed`);
  return data;
}

export async function getRunReportUrl(id: string): Promise<{ url: string }> {
  const { data } = await http.get<{ url: string }>(`/api/runs/${id}/report-url`);
  return data;
}

/** 报告正文（Markdown）。老数据没有转录文件时 available=false。 */
export async function getRunReportMarkdown(
  id: string,
): Promise<{ available: boolean; markdown: string }> {
  const { data } = await http.get<{ available: boolean; markdown: string }>(
    `/api/runs/${id}/report-markdown`,
  );
  return data;
}

export interface ReportKeyframe {
  id: string;
  url: string;
  time: number | null;
  label: string;
  kind: string;
}

export interface ReportTask {
  index: number;
  type: string;
  subType: string;
  title: string;
  detail: string;
  status: string;
  start: number | null;
  end: number | null;
  durationMs: number | null;
  error: string | null;
  thought: string;
  reasoning: string;
  usage: Record<string, unknown> | null;
  param: unknown;
  output: unknown;
  log: unknown;
}

export interface ReportExecution {
  id: string;
  name: string;
  status: string;
  start: number | null;
  end: number | null;
  durationMs: number | null;
  tasks: ReportTask[];
}

export interface ReportStep {
  id: string;
  index: number;
  phase: 'beforeEach' | 'steps' | 'afterEach';
  node: string;
  title: string;
  status: string;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string;
  thought: string;
  error: string | null;
  notRunReason: string;
  continuedAfterError: boolean;
  synthetic: boolean;
  keyframes: ReportKeyframe[];
  executions: ReportExecution[];
  param: unknown;
  outputData: unknown;
  metrics: { totalTokens?: number; [key: string]: unknown } | null;
}

export interface ReportAttempt {
  index: number;
  status: string;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReportCase {
  id: string;
  name: string;
  caseIndex: number;
  caseUuid: string | null;
  runId: string | null;
  sourcePath: string;
  status: string;
  durationMs: number | null;
  attemptCount: number;
  attempts: ReportAttempt[];
  steps: ReportStep[];
}

export interface ReportProject {
  id: string;
  name: string;
  projectName: string;
  runId: string | null;
  status: string;
  durationMs: number | null;
  shardIndex: number | null;
  shardCount: number | null;
  cases: ReportCase[];
}

export interface ReportSource {
  runId: string | null;
  projectName: string;
  status: string;
  startedAt: string | null;
  durationMs: number | null;
  shardIndex: number | null;
  shardCount: number | null;
}

export interface ReportModelUsage {
  model: string;
  description: string;
  calls: number;
  promptTokens: number;
  cachedInput: number;
  completionTokens: number;
  totalTokens: number;
  timeCost: number;
}

export interface ReportStructured {
  version: 2;
  kind: 'run' | 'batch';
  legacy: boolean;
  generatedAt: string;
  group: { name: string; description: string; sdkVersion: string; deviceType: string };
  stats: {
    projects: number;
    cases: number;
    passed: number;
    failed: number;
    notRun: number;
    steps: number;
    keyframes: number;
    start: number | null;
    end: number | null;
    durationMs: number | null;
    modelCallTimeMs: number;
    tokens: { prompt: number; cached: number; completion: number; total: number };
    models: ReportModelUsage[];
  };
  sources: ReportSource[];
  projects: ReportProject[];
}

/** 结构化报告（v2：用例 → 步骤 → 关键帧）。 */
export async function getRunReportStructured(
  id: string,
): Promise<{ available: boolean; data: ReportStructured | null }> {
  const { data } = await http.get<{ available: boolean; data: ReportStructured | null }>(
    `/api/runs/${id}/report-structured`,
  );
  return data;
}

export function isRunActive(status: RunStatus): boolean {
  return status === 'queued' || status === 'preparing' || status === 'running' || status === 'parsing';
}
