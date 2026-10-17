import type { ChatMessage } from '../api/cases';

/**
 * AI 对话草稿的本地持久化。
 *
 * 对话历史和生成的 YAML 都存在 localStorage 里，按功能分开。
 * 不这么做的话：跳走看一眼别的、刷新一下、或者 dev 环境热更新重挂组件，
 * 聊了半天的内容直接没了 —— 用户对「过往对话丢失」的反馈就是这些场景。
 *
 * 这是**草稿**，不进数据库：它只是「还没保存成用例的半成品」，保存后就该丢掉。
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
