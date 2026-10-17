import { http } from './client';
import type { Webhook, WebhookDelivery } from './types';

export interface WebhookInput {
  name: string;
  url: string;
  /** 创建时必填，之后留空表示不改 */
  secret?: string;
  events: string[];
  /** 是否连 YAML 正文一起发（用例多的时候 payload 会很大） */
  include_yaml?: boolean;
  is_active?: boolean;
}

/** 可选事件清单由后端给 —— 事件名和说明只有一处定义，前端不重复维护 */
export async function getWebhookEvents(): Promise<{ event: string; label: string }[]> {
  const { data } = await http.get<{ event: string; label: string }[]>('/api/webhook-events');
  return data;
}

export async function getWebhooks(teamId: string): Promise<Webhook[]> {
  const { data } = await http.get<Webhook[]>(`/api/teams/${teamId}/webhooks`);
  return data;
}

export async function createWebhook(teamId: string, input: WebhookInput): Promise<Webhook> {
  const { data } = await http.post<Webhook>(`/api/teams/${teamId}/webhooks`, input);
  return data;
}

export async function updateWebhook(id: string, input: Partial<WebhookInput>): Promise<Webhook> {
  const { data } = await http.patch<Webhook>(`/api/webhooks/${id}`, input);
  return data;
}

export async function deleteWebhook(id: string): Promise<void> {
  await http.delete(`/api/webhooks/${id}`);
}

/** 手动投一条测试。带 taskId 时发的是真实任务的全套数据 */
export async function testWebhook(id: string, taskId?: string): Promise<WebhookDelivery> {
  const { data } = await http.post<WebhookDelivery>(`/api/webhooks/${id}/test`, undefined, {
    params: taskId ? { task_id: taskId } : undefined,
  });
  return data;
}

export async function getDeliveries(id: string, limit = 30): Promise<WebhookDelivery[]> {
  const { data } = await http.get<WebhookDelivery[]>(`/api/webhooks/${id}/deliveries`, {
    params: { limit },
  });
  return data;
}

/** 重发：原 payload 原样入队，签名照旧有效 */
export async function redeliver(webhookId: string, deliveryId: string): Promise<void> {
  await http.post(`/api/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`);
}
