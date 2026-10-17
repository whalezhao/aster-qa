import { http } from './client';
import type { PreflightResult } from './types';

/** 执行前预检：模型、环境、额度、被测地址、执行器是否在线。 */
export async function preflightTask(taskId: string): Promise<PreflightResult> {
  const { data } = await http.post<PreflightResult>(`/api/tasks/${taskId}/preflight`);
  return data;
}
