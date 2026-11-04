import { http } from './client';

export interface AppSettings {
  /** 全局并发上限：所有 worker 加起来最多同时跑多少个 run */
  max_concurrent_runs: number;
  /** 单系统任务的分片粒度：0 表示不拆 run（一个系统一个 run） */
  run_shard_size: number;
  /** 只评估有失败的批次：全绿批次不再调模型，省一次真实调用 */
  ai_assess_failures_only: boolean;
  updated_at: string | null;
}

export interface SettingsPatch {
  max_concurrent_runs?: number;
  run_shard_size?: number;
  ai_assess_failures_only?: boolean;
}

export async function getSettings(): Promise<AppSettings> {
  const { data } = await http.get<AppSettings>('/api/settings');
  return data;
}

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const { data } = await http.put<AppSettings>('/api/settings', patch);
  return data;
}
