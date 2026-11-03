import type { RunStatus } from '../api/types';
import { getLocale, t } from '../i18n';

const ACTIVE_LABELS: Partial<Record<RunStatus, string>> = {
  queued: '排队中',
  preparing: '准备中',
  running: '执行中',
  parsing: '解析中',
};

const ACTIVE = ['queued', 'preparing', 'running', 'parsing'];

const FAILURE_KIND_LABELS: Record<string, string> = {
  ai_quota: '模型额度用尽',
  ai_config: '模型配置有误',
  ai_service: '模型服务错误',
  network: '网络不可达',
};

/** 批次状态。和 run 一样，「跑完了」不等于「通过了」，颜色要按后者来。 */
export const BATCH_STATUS_LABELS: Record<string, string> = {
  empty: '无执行',
  running: '执行中',
  completed: '完成',
  completed_with_failures: '完成 · 含失败',
  partial: '部分完成',
  excluded: '未计入统计',
  failed: '执行失败',
  cancelled: '已取消',
};

export const BATCH_STATUS_COLORS: Record<string, string> = {
  empty: 'default',
  running: 'processing',
  completed: 'success',
  completed_with_failures: 'warning',
  partial: 'warning',
  // 非用例原因（模型额度/配置/网络）导致的失败，灰色，别和真实失败混淆
  excluded: 'default',
  failed: 'error',
  cancelled: 'default',
};

/** 非用例原因导致的失败的说明文案，用于列表与详情；不是这类失败时返回 null。 */
export function failureKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return t(FAILURE_KIND_LABELS[kind] ?? kind);
}

/** 状态 / 类型的中文值在表里，展示时再过一层翻译。 */
export function batchStatusLabel(status: string): string {
  return t(BATCH_STATUS_LABELS[status] ?? status);
}

export function taskTypeLabel(type: string): string {
  return t(TASK_TYPE_LABELS[type] ?? type);
}

export function taskStatusLabel(status: string): string {
  return t(TASK_STATUS_LABELS[status] ?? status);
}

/**
 * run 的状态视图。关键：status 只表达「是否跑完」，不表达「是否通过」。
 * 有用例失败时 run 仍是 succeeded，必须靠 failed>0 才能看出「完成含失败」。
 *
 * 还要区分失败的原因：模型额度用尽之类的「非用例原因」失败如果显示成和真实用例失败
 * 一样的黄色，会让人去追根本不存在的 bug。这类用灰色单独标出来。
 */
export function runStatusView(run: {
  status: RunStatus;
  failed: number | null;
  failure_kind?: string | null;
}): { color: string; label: string } {
  if (ACTIVE.includes(run.status)) {
    return { color: 'processing', label: t(ACTIVE_LABELS[run.status] ?? run.status) };
  }
  if (run.status === 'cancelled') return { color: 'default', label: t('已取消') };

  const kind = failureKindLabel(run.failure_kind);
  if (kind) {
    return { color: 'default', label: t('未计入统计 · {kind}', { kind }) };
  }
  if (run.status === 'failed') return { color: 'error', label: t('执行失败') };
  if (run.status === 'timed_out') return { color: 'error', label: t('执行超时') };
  // succeeded：执行跑完了，通过与否看 failed
  const failed = run.failed ?? 0;
  if (failed > 0) return { color: 'warning', label: t('完成 · 含 {n} 失败', { n: failed }) };
  return { color: 'success', label: t('完成') };
}

export function fmtPercent(v: number | null | undefined, digits = 1): string {
  if (v == null) return '-';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '-';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '-';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '-';
  return new Date(v).toLocaleString(getLocale() === 'en' ? 'en-US' : 'zh-CN');
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  case_run: '单用例',
  feature_regression: '功能回归',
  iteration_regression: '迭代回归',
  adhoc: '临时',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  queued: 'processing',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
