import { API_BASE, http, TOKEN_KEY } from './client';
import type {
  AiFixResult,
  CaseHistoryItem,
  CaseOption,
  CaseStep,
  FeatureStage,
  Priority,
  TestCase,
  TestCaseDoc,
  ValidateResult,
} from './types';

export interface CaseInput {
  name?: string;
  yaml_content?: string;
  description?: string;
  priority?: Priority | null;
  defect_ids?: string | null;
  stage_override?: FeatureStage | null;
  is_active?: boolean;
  change_source?: 'manual' | 'ai_fix';
  change_note?: string | null;
}

export interface TrialStepOption {
  case_index: number;
  step: number;
  cache?: boolean;
  deep_locate?: boolean;
  timeout_ms?: number | null;
  effort?: 'fast' | 'balance' | 'deepThink';
  context?: string;
  message?: string;
}

export interface TrialRunResult {
  run_id: string;
  steps: number;
  case_count: number;
}

/** 试跑到「第 case 条的 N 步」：不落用例、不进批次，只拿逐步结果。 */
export async function trialRun(
  featureId: string,
  yamlContent: string,
  stepLimit: number,
  caseIndex: number | null,
  stepOptions: TrialStepOption[] = [],
  environmentName?: string | null,
  cache = true,
): Promise<TrialRunResult> {
  const { data } = await http.post<TrialRunResult>(
    `/api/features/${featureId}/ai/trial-run`,
    {
      yaml_content: yamlContent,
      step_limit: stepLimit,
      case_index: caseIndex,
      environment_name: environmentName ?? null,
      cache,
      step_options: stepOptions,
    },
    { timeout: 60_000 },
  );
  return data;
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

/** 任务功能树用：一次拿该系统下全部启用用例，避免按功能逐个请求。 */
export async function getProjectCases(projectId: string): Promise<CaseOption[]> {
  const { data } = await http.get<CaseOption[]>(`/api/projects/${projectId}/cases`);
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

/** 服务端保存的 AI 对话草稿（按当前用户隔离）。 */
export interface CaseAiDraft {
  messages: ChatMessage[];
  yaml: string | null;
  input: string;
}

const EMPTY_AI_DRAFT: CaseAiDraft = { messages: [], yaml: null, input: '' };

export async function getCaseAiDraft(caseId: string): Promise<CaseAiDraft> {
  const { data } = await http.get<CaseAiDraft>(`/api/cases/${caseId}/ai-draft`);
  return data ?? EMPTY_AI_DRAFT;
}

export async function saveCaseAiDraft(caseId: string, state: CaseAiDraft): Promise<void> {
  await http.put(`/api/cases/${caseId}/ai-draft`, state);
}

export async function getFeatureAiDraft(featureId: string): Promise<CaseAiDraft> {
  const { data } = await http.get<CaseAiDraft>(`/api/features/${featureId}/ai-draft`);
  return data ?? EMPTY_AI_DRAFT;
}

export async function saveFeatureAiDraft(
  featureId: string,
  state: CaseAiDraft,
): Promise<void> {
  await http.put(`/api/features/${featureId}/ai-draft`, state);
}

export interface CaseDraftResult {
  reply: string;
  /** 这轮模型给出的 YAML；只回答问题时为 null */
  yaml: string | null;
  yaml_ok: boolean;
  yaml_errors: string[];
  usage: Record<string, number>;
  diff: string | null;
  lock_violated: boolean;
  steps: CaseStep[];
  /** 给 TestCase.description 的交付摘要（多条 case 会列出来） */
  description: string | null;
  /** 交付用的测试用例表 */
  test_cases: TestCaseDoc[];
}

/** 把当前 YAML 展开成测试用例表，下载 Excel。 */
export async function exportFeatureCases(
  featureId: string,
  yamlContent: string,
  caseSetName: string | null,
): Promise<Blob> {
  const { data } = await http.post(
    `/api/features/${featureId}/test-cases/export`,
    { yaml_content: yamlContent, case_set_name: caseSetName },
    { responseType: 'blob', timeout: 60_000 },
  );
  return data;
}

/**
 * 通过对话生成用例 YAML。用的是系统上配好的模型。
 * 对话历史由前端保存并整段回传，后端不存会话状态。
 */
export async function draftCaseWithAi(
  featureId: string,
  messages: ChatMessage[],
  currentYaml?: string | null,
  mode: 'rewrite' | 'append' = 'rewrite',
): Promise<CaseDraftResult> {
  const { data } = await http.post<CaseDraftResult>(
    `/api/features/${featureId}/ai/case-draft`,
    { messages, current_yaml: currentYaml ?? null, mode },
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
  mode: 'rewrite' | 'append' = 'rewrite',
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_BASE}/api/features/${featureId}/ai/case-draft/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, current_yaml: currentYaml, mode }),
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
