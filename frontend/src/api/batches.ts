import { http } from './client';
import type { ReportStructured } from './runs';
import type { RunStatus } from './types';

/** 批次状态。派生自它下面的 runs，不落库。 */
export type BatchStatus =
  | 'empty'
  | 'running'
  | 'completed'
  | 'completed_with_failures'
  | 'partial'
  /** 执行没跑成，且原因是非用例的（模型额度/配置/网络），不计入通过率 */
  | 'excluded'
  | 'failed'
  | 'cancelled';

/** 批次里某个功能的测试状态 —— 执行记录每行展示的就是这些。 */
export interface BatchFeature {
  feature_id: string;
  name: string;
  stage: 'in_iteration' | 'released';
  total: number;
  passed: number;
  failed: number;
}

export interface Batch {
  id: string;
  task_id: string | null;
  /** 上游测试任务（批次创建时的归属任务；任务删了批次也一起删，理论上有 id 就有它） */
  task_name: string | null;
  task_type: string | null;
  task_status: string | null;
  task_feature_count: number;
  task_case_count: number;
  /** 最近一次 AI 评估（列表上直接标出来） */
  ai_status: 'pending' | 'done' | 'failed' | null;
  ai_verdict: 'healthy' | 'risky' | 'needs_attention' | 'unknown' | null;
  team_id: string;
  team_name?: string | null;
  iteration_id: string | null;
  name: string;
  trigger: 'manual' | 'regression';
  created_at: string;
  created_by_name?: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number;
  runs: number;
  project_count: number;
  total: number;
  passed: number;
  failed: number;
  /** 因非用例原因（模型额度/配置/网络）被排除在统计之外的 run 数 */
  excluded_runs: number;
  status: BatchStatus;
  features: BatchFeature[];
}

/** 批次下的单个 run —— 一次 midscene 执行，只属于一个项目。 */
export interface BatchRun {
  id: string;
  project_id: string | null;
  project_name: string | null;
  status: RunStatus;
  total: number | null;
  passed: number | null;
  failed: number | null;
  duration_ms: number | null;
  model_name: string | null;
  failure_kind: string | null;
  report_available: boolean;
  started_at: string | null;
  shard_index: number | null;
  shard_count: number | null;
}

export interface BatchDetail extends Batch {
  run_items: BatchRun[];
}

export interface BatchListParams {
  team_id?: string;
  project_id?: string;
  task_id?: string;
  iteration_id?: string;
  /** 按功能分期过滤：批次里只要有该分期的功能就算命中 */
  stage?: 'in_iteration' | 'released';
  name?: string;
  limit?: number;
  offset?: number;
}

export async function getBatches(params: BatchListParams): Promise<{ items: Batch[]; total: number }> {
  const { data } = await http.get<{ items: Batch[]; total: number }>('/api/batches', { params });
  return data;
}

export async function getBatch(id: string): Promise<BatchDetail> {
  const { data } = await http.get<BatchDetail>(`/api/batches/${id}`);
  return data;
}

/** 任务级聚合报告：批次下所有 run 的报告合并后的 v2 结构。 */
export async function getBatchReportStructured(
  id: string,
): Promise<{ available: boolean; data: ReportStructured | null; fallback_run_id: string | null }> {
  const { data } = await http.get<{
    available: boolean;
    data: ReportStructured | null;
    fallback_run_id: string | null;
  }>(`/api/batches/${id}/report-structured`);
  return data;
}

export interface BatchSignoffInfo {
  id: string;
  report_hash: string;
  case_count: number;
  passed: number;
  failed: number;
  note: string | null;
  signed_at: string;
  signed_by_name: string | null;
}

export interface BatchSignoff {
  signed: boolean;
  stale: boolean;
  report_available: boolean;
  report_hash: string | null;
  can_sign: boolean;
  signoff: BatchSignoffInfo | null;
}

export async function getBatchSignoff(id: string): Promise<BatchSignoff> {
  const { data } = await http.get<BatchSignoff>(`/api/batches/${id}/report-signoff`);
  return data;
}

export async function signBatchReport(id: string, note?: string): Promise<BatchSignoff> {
  const { data } = await http.post<BatchSignoff>(`/api/batches/${id}/report-signoff`, {
    note: note ?? null,
  });
  return data;
}

export async function revokeBatchReportSignoff(id: string): Promise<BatchSignoff> {
  const { data } = await http.post<BatchSignoff>(`/api/batches/${id}/report-signoff/revoke`);
  return data;
}
