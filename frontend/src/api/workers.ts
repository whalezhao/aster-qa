import { http } from './client';
import type { WorkerStatus } from './types';

export async function getWorkerStatus(): Promise<WorkerStatus> {
  const { data } = await http.get<WorkerStatus>('/api/workers/status');
  return data;
}
