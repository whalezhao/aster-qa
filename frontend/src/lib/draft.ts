import type { ChatMessage } from '../api/cases';

/**
 * AI 对话草稿的本地缓存。
 *
 * 对话的权威副本在数据库（按用户 + 用例/功能保存）；localStorage 只做本机兜底：
 * 刷新、热更新、数据库请求失败时至少不丢内容。第一次打开旧页面时，
 * CaseDraft 会把本机已有的草稿迁移到数据库。
 */
/** key 由调用方给：新建用例用 `feature_<fid>`，修改用案用 `case_<cid>`，互不干扰 */
const KEY = (draftKey: string) => `qa_case_draft_${draftKey}`;

export interface CaseDraftState {
  messages: ChatMessage[];
  yaml: string | null;
  input: string;
}

const EMPTY: CaseDraftState = { messages: [], yaml: null, input: '' };

export function loadDraft(draftKey: string): CaseDraftState {
  try {
    const raw = localStorage.getItem(KEY(draftKey));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CaseDraftState>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      yaml: typeof parsed.yaml === 'string' ? parsed.yaml : null,
      input: typeof parsed.input === 'string' ? parsed.input : '',
    };
  } catch {
    // 存的东西坏了就当没存过，不要让页面白屏
    return EMPTY;
  }
}

export function saveDraft(draftKey: string, state: CaseDraftState): void {
  try {
    if (!state.messages.length && !state.yaml && !state.input) {
      localStorage.removeItem(KEY(draftKey));
      return;
    }
    localStorage.setItem(KEY(draftKey), JSON.stringify(state));
  } catch {
    // 存储写满或被禁用时不影响使用
  }
}

export function clearDraft(draftKey: string): void {
  localStorage.removeItem(KEY(draftKey));
}
