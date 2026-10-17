import { http } from './client';
import type { TaskSchedule } from './types';

export async function getSchedule(taskId: string): Promise<TaskSchedule | null> {
  const { data } = await http.get<TaskSchedule | null>(`/api/tasks/${taskId}/schedule`);
  return data;
}

export async function saveSchedule(
  taskId: string,
  input: { cron: string; timezone: string; enabled: boolean },
): Promise<TaskSchedule> {
  const { data } = await http.put<TaskSchedule>(`/api/tasks/${taskId}/schedule`, input);
  return data;
}

export async function deleteSchedule(taskId: string): Promise<void> {
  await http.delete(`/api/tasks/${taskId}/schedule`);
}
