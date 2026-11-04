import { http } from './client';
import type { AiCheckResult } from './types';

/** 批次最新一次的 AI 评估（pending 时前端轮询，done 后展示）。 */
export async function getBatchCheck(batchId: string): Promise<AiCheckResult> {
  const { data } = await http.get<AiCheckResult>(`/api/batches/${batchId}/ai-check`);
  return data;
}

/** 用当前口径重新评估一次（异步，返回 pending，前端继续轮询）。 */
export async function rerunBatchCheck(batchId: string): Promise<AiCheckResult> {
  const { data } = await http.post<AiCheckResult>(`/api/batches/${batchId}/ai-check`);
  return data;
}

/** 签名前的 AI 预检。同步调用模型，可能几十秒。 */
export async function runTaskPrecheck(taskId: string): Promise<AiCheckResult> {
  const { data } = await http.post<AiCheckResult>(`/api/tasks/${taskId}/ai/precheck`);
  return data;
}

/** 生成测试团队复盘（Markdown）。同步调用模型。 */
export async function runTeamReview(teamId: string, days: number): Promise<AiCheckResult> {
  const { data } = await http.post<AiCheckResult>(
    `/api/teams/${teamId}/ai/review`,
    undefined,
    { params: { days } },
  );
  return data;
}

/** 最近一次测试团队复盘，打开页面先展示，不用每次重新生成。 */
export async function getLatestTeamReview(teamId: string): Promise<AiCheckResult> {
  const { data } = await http.get<AiCheckResult>(`/api/teams/${teamId}/ai/review/latest`);
  return data;
}
