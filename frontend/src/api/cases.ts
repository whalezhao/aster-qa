import { API_BASE, http, TOKEN_KEY } from './client';
import type {
  AiFixResult,
  CaseHistoryItem,
  FeatureStage,
  Priority,
  TestCase,
  ValidateResult,
} from './types';

export interface CaseInput {
  name?: string;
  yaml_content?: string;
  description?: string;
  priority?: Priority | null;
  defect_ids?: string | null;
  stage_override?: FeatureStage | null;
  change_source?: 'manual' | 'ai_fix';
  change_note?: string | null;
}

export async function validateYaml(yaml_content: string): Promise<ValidateResult> {
  const { data } = await http.post<ValidateResult>('/api/cases/validate', { yaml_content });
  return data;
}

export async function getCases(featureId: string): Promise<TestCase[]> {
  const { data } = await http.get<TestCase[]>(`/api/features/${featureId}/cases`);
  return data;
}
export async function createCase(
  featureId: string,
  input: Required<Pick<CaseInput, 'name' | 'yaml_content'>> & CaseInput,
): Promise<TestCase> {
  const { data } = await http.post<TestCase>(`/api/features/${featureId}/cases`, input);
  return data;
}

export async function getCase(id: string): Promise<TestCase> {
  const { data } = await http.get<TestCase>(`/api/cases/${id}`);
  return data;
}

export async function updateCase(id: string, input: CaseInput): Promise<TestCase> {
  const { data } = await http.patch<TestCase>(`/api/cases/${id}`, input);
  return data;
}

export async function deleteCase(id: string): Promise<void> {
  await http.delete(`/api/cases/${id}`);
}

export async function getCaseHistory(id: string): Promise<CaseHistoryItem[]> {
  const { data } = await http.get<CaseHistoryItem[]>(`/api/cases/${id}/history`);
  return data;
}

/** 基于最近一次失败让 AI 生成修复建议；不会自动保存。 */
export async function aiFixCase(
  id: string,
  runId?: string | null,
): Promise<AiFixResult> {
  const { data } = await http.post<AiFixResult>(
    `/api/cases/${id}/ai-fix`,
    { run_id: runId ?? null },
    { timeout: 180_000 },
  );
  return data;
}

// ------------------------------------------------- AI 对话生成用例

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CaseDraftResult {
  reply: string;
  /** 这轮模型给出的 YAML；只回答问题时为 null */
  yaml: string | null;
  yaml_ok: boolean;
  yaml_errors: string[];
  usage: Record<string, number>;
}

/**
 * 通过对话生成用例 YAML。用的是系统上配好的模型。
 * 对话历史由前端保存并整段回传，后端不存会话状态。
 */
export async function draftCaseWithAi(
  featureId: string,
  messages: ChatMessage[],
  currentYaml?: string | null,
): Promise<CaseDraftResult> {
  const { data } = await http.post<CaseDraftResult>(
    `/api/features/${featureId}/ai/case-draft`,
    { messages, current_yaml: currentYaml ?? null },
    // 模型生成一份用例要几秒到几十秒，默认超时不够
    { timeout: 180_000 },
  );
  return data;
}

export interface DraftStreamHandlers {
  onDelta: (text: string) => void;
  onDone: (result: CaseDraftResult) => void;
  onError: (message: string) => void;
}

/**
 * 流式生成用例：SSE 逐段返回文本，最后给一份结构化结果。
 *
 * 用 fetch 而不是 axios：需要读 `response.body` 的流，axios 在浏览器里拿不到增量。
 */
export async function draftCaseWithAiStream(
  featureId: string,
  messages: ChatMessage[],
  currentYaml: string | null,
  handlers: DraftStreamHandlers,
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_BASE}/api/features/${featureId}/ai/case-draft/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, current_yaml: currentYaml }),
  });

  if (!response.ok || !response.body) {
    let detail = `请求失败（${response.status}）`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // 非 JSON（例如网关错误页），保留状态码文案
    }
    handlers.onError(detail);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const handleChunk = (chunk: string) => {
    let event = 'message';
    let data = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    try {
      const payload = JSON.parse(data);
      if (event === 'delta') handlers.onDelta(String(payload.text ?? ''));
      else if (event === 'done') {
        finished = true;
        handlers.onDone(payload as CaseDraftResult);
      } else if (event === 'error') {
        finished = true;
        handlers.onError(String(payload.message ?? 'AI 调用失败'));
      }
    } catch {
      // 半行 JSON（SSE 分块边界），等下一块拼上
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      handleChunk(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf('\n\n');
    }
  }
  if (!finished) handlers.onError('连接中断，请重试');
}
