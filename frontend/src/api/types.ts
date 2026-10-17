// 后端接口响应类型集中定义。字段与后端契约保持一致。

export type Role = 'owner' | 'admin' | 'member';
export type IterationStatus = 'planned' | 'active' | 'released' | 'archived';
export type FeatureStage = 'in_iteration' | 'released';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  /** 内置卡通头像的 key；空 = 用首字母头像 */
  avatar: string | null;
  is_active: boolean;
  teams: { team_id: string; role: Role }[];
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  avatar: string | null;
  is_active: boolean;
  /** 只有人员维护页会请求（?with_teams=1），且只含调用者自己看得到的团队 */
  teams?: { id: string; name: string; role: Role }[];
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
}

export interface TeamMember {
  user_id: string;
  role: Role;
  user: Pick<User, 'id' | 'username' | 'display_name'>;
}

export interface ProjectHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  message: string | null;
  model_name: string | null;
  latency_ms: number | null;
  checked_at: string | null;
  source: 'periodic' | 'manual' | null;
}

export interface Project {
  id: string;
  team_id: string;
  name: string;
  code: string | null;
  description: string | null;
  base_url: string | null;
  status: string;
  /** 项目是否已配好大模型（模型名 + 接入地址 + API Key 齐全）。
   *  没有全局兜底：没配就不允许执行该项目的用例。 */
  has_model_config: boolean;
  model_health?: ProjectHealth | null;
}

export interface Iteration {
  id: string;
  team_id: string;
  name: string;
  version: string | null;
  status: IterationStatus;
  start_date: string | null;
  end_date: string | null;
}

export interface Tag {
  id: string;
  team_id: string;
  name: string;
  color: string | null;
  iteration_id: string | null;
  description: string | null;
}

export interface Feature {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  /** 禅道/Jira 的需求编号，可填多个（逗号分隔） */
  requirement_ids: string | null;
  stage: FeatureStage;
  iteration_id: string | null;
  released_at: string | null;
}

export interface TestCase {
  id: string;
  feature_id: string;
  name: string;
  description: string | null;
  yaml_content: string;
  priority: Priority | null;
  /** 这条用例是为哪些缺陷补的（禅道/Jira 的 bug 单号，逗号分隔可多个） */
  defect_ids: string | null;
  stage_override: FeatureStage | null;
  is_active: boolean;
  /** 后端派生字段：COALESCE(stage_override, 功能.stage)，只读 */
  effective_stage: FeatureStage;
  /** 用例本身不存项目，后端从 feature 上溯带出来，供「该项目未配模型」的提示用 */
  project_id: string | null;
  /** 最新版本号（版本历史） */
  version_no?: number | null;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  case_count: number;
}

export interface CaseHistoryItem {
  run_id: string;
  /** 这次执行所属的批次 —— 点进去能看到同一次执行里其他功能/项目的结果 */
  batch_id: string | null;
  batch_name: string | null;
  team_name: string | null;
  project_name: string | null;
  iteration_name: string | null;
  /** midscene 的用例结果：success | failed | notRun */
  status: string;
  attempt_count: number;
  passed_after_retry: boolean;
  run_status: string;
  failure_kind: string | null;
  model_name: string | null;
  report_available: boolean;
  started_at: string | null;
  duration_ms: number | null;
}

export interface BulkReleaseResult {
  released: unknown[];
  skipped: unknown[];
}

// 422 参数校验失败时 detail 是对象数组
export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface ApiErrorBody {
  detail: string | ValidationErrorItem[];
}

// ===== 测试任务 =====
export type TaskType = 'case_run' | 'feature_regression' | 'iteration_regression' | 'adhoc';
export type TaskStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  team_id: string;
  project_id: string | null;
  name: string;
  type: TaskType;
  description: string | null;
  iteration_id: string | null;
  status: TaskStatus;
  retry_count: number;
  environment_name: string | null;
  gate_enabled: boolean;
  gate_min_pass_rate: number | null;
  gate_fail_on_p0: boolean;
  case_selection_mode: string;
  /** 下面几个由后端聚合填充 —— 任务列表要能直接看出组合规模与最近执行情况 */
  feature_count: number;
  case_count: number;
  last_batch_id: string | null;
  last_batch_status: string | null;
  last_run_at: string | null;
  /** 定时计划摘要 */
  schedule_enabled: boolean;
  schedule_cron: string | null;
  schedule_next_run_at: string | null;
  schedule_last_status: string | null;
  /** 人工签名：这个任务的用例集有没有人签过 */
  signed: boolean;
  signed_at: string | null;
}

export interface TaskCase {
  id: string;
  name: string;
  priority: Priority | null;
  defect_ids: string | null;
  is_active: boolean;
  effective_stage: FeatureStage;
  feature_id: string;
  feature_name: string;
  feature_requirement_ids: string | null;
  project_id: string;
  source_feature_id: string;
}

export interface TaskTag {
  id: string;
  name: string;
  color: string | null;
  iteration_id: string | null;
}

export interface RegressionTaskResult {
  task_id: string;
  case_count: number;
  feature_count: number;
  run_ids: string[];
  /** 用户视角的「一次执行」批次；跨项目时 run 会有多个但批次只有一个 */
  batch_id: string | null;
}

// ===== 执行 =====
export type RunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'parsing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface Run {
  id: string;
  task_id: string | null;
  team_id: string;
  project_id: string | null;
  iteration_id: string | null;
  status: RunStatus;
  midscene_status: string | null;
  exit_code: number | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  // 还没跑完的 run 这些指标都是 null，渲染时要兜住
  total: number | null;
  passed: number | null;
  failed: number | null;
  not_run: number | null;
  passed_after_retry: number | null;
  final_pass_rate: number | null;
  first_pass_rate: number | null;
  model_name: string | null;
  error_message: string | null;
  /** 非用例原因导致的失败：ai_quota（额度用尽）/ ai_service / network。
   *  这些不计入统计通过率，UI 上要和真实的用例失败区分开。 */
  failure_kind: string | null;
  environment_id: string | null;
  environment_name: string | null;
  environment_base_url: string | null;
}

export interface RunProgress {
  done: number;
  total: number;
  percent: number;
}

export interface RunDetail extends Run {
  work_dir: string;
  report_available: boolean;
  ai_calls: number;
  ai_total_tokens: number;
  ai_cost_ms: number;
  progress: RunProgress;
}

export interface RunCase {
  id: string;
  test_case_id: string | null;
  source_path: string | null;
  name: string;
  case_index: number;
  status: string;
  attempt_count: number;
  passed_after_retry: boolean;
}

export interface RunListResponse {
  items: Run[];
  total: number;
}

// ===== 统计 =====
export interface StatsMetrics {
  runs: number;
  sample_size: number;
  total: number;
  passed: number;
  failed: number;
  passed_after_retry: number;
  final_pass_rate: number | null;
  first_pass_rate: number | null;
  retry_recovery_rate: number | null;
  pass_rate_lower_bound: number | null;
  sample_sufficient: boolean;
  avg_duration_ms: number | null;
  median_duration_ms: number | null;
  date_from?: string;
  date_to?: string;
}

export interface StatsOverview extends StatsMetrics {
  scope: { team_id: string | null; project_id: string | null; iteration_id: string | null };
  ai_calls: number;
  ai_total_tokens: number;
  ai_cost_ms: number;
  ai_prompt_cache_tokens: number;
  /** 因模型额度/服务/网络问题被排除在通过率之外的执行次数。必须展示出来 —— 静默丢数据是另一种撒谎。 */
  excluded_infra_runs: number;
  /** 上一个等长周期的指标，用于环比；没给日期区间时为 null */
  compare: StatsMetrics | null;
}

export interface StatsStatusBucket {
  key: 'all_passed' | 'with_failures' | 'exec_failed' | 'excluded' | 'interrupted';
  label: string;
  runs: number;
  cases: number;
  failed_cases: number;
}

export interface StatsFailureKind {
  kind: string;
  label: string;
  runs: number;
}

export interface StatsTopFeature {
  feature_id: string;
  feature_name: string;
  project_name: string;
  failures: number;
}

export interface StatsDurationBucket {
  bucket: string;
  label: string;
  runs: number;
}

export interface StatsBreakdown {
  status_breakdown: StatsStatusBucket[];
  failure_kinds: StatsFailureKind[];
  top_failing_features: StatsTopFeature[];
  duration_buckets: StatsDurationBucket[];
}

export interface StatsTrendPoint {
  bucket: string | null;
  runs: number;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number | null;
  pass_rate_lower_bound: number | null;
}

export interface StatsFailure {
  test_case_id: string;
  case_name: string;
  feature_name: string | null;
  failures: number;
}

export interface StatsFlaky {
  test_case_id: string;
  case_name: string;
  feature_name: string | null;
  runs: number;
  passed: number;
  failed: number;
  flakiness: number;
  last_status: string | null;
  last_run_at: string | null;
}

export interface StatsCost {
  by_day: { day: string; total_tokens: number; cost_ms: number; ai_calls: number }[];
  by_model: { model: string; runs: number; total_tokens: number; cost_ms: number }[];
}

export interface StatsRegressionRow {
  task_id: string;
  name: string;
  status: TaskStatus;
  iteration_id: string | null;
  runs: number;
  features: number;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number | null;
  pass_rate_lower_bound: number | null;
}

/** 一次人工签名（任务的用例集被谁、何时认可）。 */
export interface SignoffInfo {
  id: string;
  /** 签名时用例集的内容指纹 */
  case_hash: string;
  case_count: number;
  note: string | null;
  signed_at: string;
  signed_by: User | null;
}

export interface TaskSignoff {
  signed: boolean;
  /** 签名时的用例集和现在对不上（有人改了用例）—— 签名不能再当有效 */
  stale: boolean;
  current_case_count: number;
  signoff: SignoffInfo | null;
}

export interface Webhook {
  id: string;
  team_id: string;
  name: string;
  kind: 'generic' | 'wecom' | 'feishu' | 'dingtalk' | 'slack';
  url: string;
  events: string[];
  include_yaml: boolean;
  is_active: boolean;
  /** 密钥只回「设没设」，原文永远拿不回来 */
  secret_set: boolean;
  created_by: string | null;
  created_at: string;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  response_status: number | null;
  response_snippet: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** AI 结论的统一形状：执行评估 / 签名预检 / 团队复盘共用。 */
export interface AiDiagnosis {
  case?: string;
  cause?: string;
  /** case=用例写错，product=产品缺陷，env=环境/数据问题 */
  owner?: 'case' | 'product' | 'env' | string;
  action?: string;
}

export interface AiCheckResult {
  status: 'none' | 'pending' | 'done' | 'failed';
  verdict: string | null;
  summary: string | null;
  reasons: string[];
  advice: string[];
  /** 执行评估的逐条失败诊断 */
  diagnoses?: AiDiagnosis[];
  /** 团队复盘是整段 Markdown */
  markdown: string | null;
  model_name: string | null;
  error: string | null;
  created_at: string | null;
}

// ===== 预检 / 执行器 / 环境 / CI / 定时 / 版本 / 覆盖 =====

export interface PreflightCheck {
  key: string;
  ok: boolean;
  severity: 'ok' | 'warning' | 'error' | 'info';
  message: string;
  overridable: boolean;
  project_id: string | null;
  project_name: string | null;
}

export interface PreflightResult {
  checks: PreflightCheck[];
  can_run: boolean;
  environment_name: string;
}

export interface WorkerInfo {
  id: string;
  hostname: string | null;
  pid: number | null;
  slots: number;
  started_at: string | null;
  heartbeat_at: string | null;
  age_seconds: number;
  active_runs: number;
}

export interface WorkerStatus {
  workers: WorkerInfo[];
  stale_workers: number;
  queued_runs: number;
  active_runs: number;
  max_concurrent_runs: number;
  worker_stale_seconds: number;
  avg_duration_ms: number | null;
  oldest_queue_seconds: number | null;
}

export interface EnvironmentVariable {
  id: string;
  key: string;
  value: string | null;
  is_secret: boolean;
  value_set: boolean;
  description: string | null;
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  base_url: string | null;
  is_default: boolean;
  variables: EnvironmentVariable[];
}

export interface EnvironmentVariableInput {
  key: string;
  value?: string | null;
  is_secret?: boolean;
  description?: string | null;
  clear?: boolean;
}

export interface ApiToken {
  id: string;
  team_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface ApiTokenCreated extends ApiToken {
  token: string;
}

export interface TaskSchedule {
  id: string;
  task_id: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_batch_id: string | null;
  last_status: 'queued' | 'skipped_overlap' | 'failed' | null;
  last_error: string | null;
  overlap_skipped: number;
}

export interface CaseVersion {
  id: string;
  case_id: string;
  version_no: number;
  name: string;
  description: string | null;
  yaml_content: string;
  priority: Priority | null;
  defect_ids: string | null;
  stage_override: FeatureStage | null;
  is_active: boolean;
  change_source: 'create' | 'manual' | 'ai_fix' | 'rollback' | 'backfill';
  change_note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface GateResult {
  status: 'disabled' | 'pending' | 'no_data' | 'passed' | 'failed';
  passed: boolean;
  enabled: boolean;
  reasons: string[];
  min_pass_rate: number | null;
  fail_on_p0: boolean;
  total: number;
  passed_cases: number;
  failed_cases: number;
  not_run: number;
  failed_p0: number;
  execution_failures: number;
  excluded_runs: number;
  pass_rate: number | null;
}

export interface CoverageItem {
  requirement_id: string;
  features: string[];
  feature_ids: string[];
  projects: string[];
  case_count: number;
  executed: number;
  passed: number;
  failed: number;
  infra: number;
  not_run: number;
  coverage_rate: number;
  pass_rate: number | null;
  status: 'covered' | 'partial' | 'not_run' | 'infra' | 'failed' | 'gap';
  last_run_at: string | null;
}

export interface CoverageResult {
  summary: Record<string, number>;
  requirements: CoverageItem[];
}

export interface AiFixResult {
  run_id: string;
  proposed_yaml: string;
  explanation: string;
  diff: string;
  yaml_ok: boolean;
  yaml_errors: string[];
  model_name: string | null;
}
