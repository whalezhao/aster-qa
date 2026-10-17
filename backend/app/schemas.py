import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ORM = ConfigDict(from_attributes=True)


class In(BaseModel):
    """所有写入模型的基类：拒绝未声明的字段，避免前端塞进意外字段。"""

    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------------------- 认证


class LoginIn(In):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PasswordChangeIn(In):
    old_password: str
    new_password: str = Field(min_length=6)


# ------------------------------------------------------------------------------- 用户


class UserTeamOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    name: str
    role: str


class UserOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    username: str
    email: str | None
    display_name: str | None
    # 内置卡通头像的 key（见前端 UserAvatar 的预设表）；空 = 用首字母头像
    avatar: str | None = None
    is_active: bool
    # 只有 list_users 带 with_teams=1 时才填（人员维护页要看「这人在哪些团队、什么角色」），
    # 其余场合是空列表，不加查询
    teams: list[UserTeamOut] = []


class UserCreate(In):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6)
    email: str | None = None
    display_name: str | None = None
    avatar: str | None = Field(default=None, max_length=32)


class UserUpdate(In):
    email: str | None = None
    display_name: str | None = None
    avatar: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=6)


class MeOut(UserOut):
    teams: list["TeamMembershipOut"]


# ------------------------------------------------------------------------------- 团队


class TeamOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    name: str
    description: str | None


class TeamCreate(In):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None


class TeamUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None


class TeamMembershipOut(BaseModel):
    model_config = ORM
    team_id: uuid.UUID
    role: str


class MemberOut(BaseModel):
    model_config = ORM
    user_id: uuid.UUID
    role: str
    user: UserOut


class MemberAdd(In):
    user_id: uuid.UUID
    role: str = "member"


class MemberUpdate(In):
    role: str


# ------------------------------------------------------------------- 项目 / 迭代 / 标签


class ProjectOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    code: str | None
    description: str | None
    base_url: str | None
    status: str
    # 项目是否已配置自己的大模型。没配就不允许执行该项目的用例，
    # 前端列表和用例页据此提示。默认 False，由路由填充。
    has_model_config: bool = False


class ProjectCreate(In):
    name: str = Field(min_length=1, max_length=128)
    code: str | None = None
    description: str | None = None
    base_url: str | None = None


class ProjectUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    code: str | None = None
    description: str | None = None
    base_url: str | None = None
    status: str | None = None


class ModelConfigOut(BaseModel):
    """项目级模型配置。

    **绝不包含 api_key 本身**，只给 api_key_set 表示是否已配。前端不需要知道密钥，
    只需要知道「配了没」和「要不要改」。
    """

    configured: bool = False
    # 还缺哪些必填项的中文名，用于界面直接说清楚「差什么」
    missing: list[str] = []
    model_name: str | None = None
    model_family: str | None = None
    base_url: str | None = None
    init_config_json: str | None = None
    api_key_set: bool = False
    # None = 跟随全局
    reasoning_enabled: bool | None = None
    # 每月 token 限额；None/0 = 不限
    token_quota: int | None = None
    # 本自然月已用（执行器 + 平台侧），用于界面上直接显示「用了多少 / 限额多少」
    month_tokens_used: int = 0


class ModelConfigIn(In):
    """逐字段覆盖：留空的字段继续用全局配置。

    api_key 不能靠「留空即不变」表达，因为那样就没法清空它 —— 用 clear_api_key 显式清除。
    reasoning_enabled 用三态：不传=不改，clear_reasoning=恢复跟随全局，true/false=显式设置。
    """

    model_name: str | None = None
    model_family: str | None = None
    base_url: str | None = None
    init_config_json: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    reasoning_enabled: bool | None = None
    clear_reasoning: bool = False
    # 0 或不传 = 不改；要清空限额用 clear_token_quota
    token_quota: int | None = Field(default=None, ge=0)
    clear_token_quota: bool = False


class IterationOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    version: str | None
    status: str
    start_date: date | None
    end_date: date | None


class IterationCreate(In):
    name: str = Field(min_length=1, max_length=64)
    version: str | None = None
    status: str = "planned"
    start_date: date | None = None
    end_date: date | None = None


class IterationUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    version: str | None = None
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class TagOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    color: str | None
    iteration_id: uuid.UUID | None
    description: str | None


class TagCreate(In):
    name: str = Field(min_length=1, max_length=64)
    color: str | None = None
    iteration_id: uuid.UUID | None = None
    description: str | None = None


class TagUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = None
    iteration_id: uuid.UUID | None = None
    description: str | None = None


# ------------------------------------------------------------------- 功能 / 测试用例


class FeatureOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str | None
    requirement_ids: str | None
    stage: str
    iteration_id: uuid.UUID | None
    released_at: datetime | None


class FeatureCreate(In):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    requirement_ids: str | None = Field(default=None, max_length=255)
    iteration_id: uuid.UUID | None = None


class FeatureUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    requirement_ids: str | None = Field(default=None, max_length=255)
    iteration_id: uuid.UUID | None = None


class ReleaseIn(In):
    # 带上 stage_override='in_iteration' 的用例是否也一起转正
    cascade: bool = False


class BulkIds(In):
    ids: list[uuid.UUID] = Field(min_length=1)


class TestCaseOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    feature_id: uuid.UUID
    name: str
    description: str | None
    yaml_content: str
    priority: str | None
    defect_ids: str | None
    stage_override: str | None
    is_active: bool
    effective_stage: str
    # 用例编辑页要据此提示「这个项目还没配模型」，但用例本身只知道 feature，
    # 所以把 project_id 一并带上，省一次来回
    project_id: uuid.UUID | None = None


class TestCaseBrief(BaseModel):
    model_config = ORM
    id: uuid.UUID
    feature_id: uuid.UUID
    name: str
    priority: str | None
    defect_ids: str | None
    is_active: bool
    effective_stage: str


class TestCaseCreate(In):
    name: str = Field(min_length=1, max_length=128)
    yaml_content: str = Field(min_length=1)
    description: str | None = None
    priority: str | None = None
    defect_ids: str | None = Field(default=None, max_length=255)
    stage_override: str | None = None


class TestCaseUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    yaml_content: str | None = Field(default=None, min_length=1)
    description: str | None = None
    priority: str | None = None
    defect_ids: str | None = Field(default=None, max_length=255)
    stage_override: str | None = None
    is_active: bool | None = None


class YamlValidateIn(In):
    yaml_content: str


# ------------------------------------------------------------------ AI 生成用例


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class CaseDraftIn(In):
    """对话历史由前端保存并整段回传，后端不存会话状态。"""

    messages: list[ChatMessage] = Field(min_length=1)
    # 当前正在迭代的 YAML，模型据此在原有基础上改
    current_yaml: str | None = None


class CaseDraftOut(BaseModel):
    reply: str
    # 模型回复里提取出的 YAML；这轮没给 YAML 时为 null
    yaml: str | None = None
    yaml_ok: bool = False
    yaml_errors: list[str] = []
    usage: dict = {}


class YamlValidateOut(BaseModel):
    ok: bool
    errors: list[str] = []
    case_count: int = 0


# ------------------------------------------------------------------- 任务 / 回归


class TaskOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    team_id: uuid.UUID
    project_id: uuid.UUID | None
    name: str
    type: str
    description: str | None
    iteration_id: uuid.UUID | None
    status: str
    retry_count: int
    case_selection_mode: str
    # 下面这些由列表接口聚合填充 —— 任务粒度的列表要能直接看出
    # 「组合了几个功能、多少用例、最近跑得怎么样」
    feature_count: int = 0
    case_count: int = 0
    last_batch_id: uuid.UUID | None = None
    last_batch_status: str | None = None
    last_run_at: datetime | None = None
    # 人审签名：列表上要一眼看出「这个任务有没有人签过」
    signed: bool = False
    signed_at: datetime | None = None


class TaskCreate(In):
    """建任务。一个任务就是一堆功能的组合，所以功能可以在建的当下直接选。

    feature_ids 会连同其下启用中的用例一起快照进任务；不选也行，之后再补。
    """

    name: str = Field(min_length=1, max_length=128)
    type: str = "case_run"
    description: str | None = None
    project_id: uuid.UUID | None = None
    iteration_id: uuid.UUID | None = None
    retry_count: int = Field(default=0, ge=0, le=5)
    feature_ids: list[uuid.UUID] = []
    tag_ids: list[uuid.UUID] = []
    run_now: bool = False


class TaskUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    iteration_id: uuid.UUID | None = None
    retry_count: int | None = Field(default=None, ge=0, le=5)


class CaseIdList(In):
    case_ids: list[uuid.UUID] = []


class TaskIdList(In):
    task_ids: list[uuid.UUID] = []


class TagIdList(In):
    tag_ids: list[uuid.UUID] = []


class FeatureIdList(In):
    feature_ids: list[uuid.UUID] = []


class RegressionCreate(In):
    """多选功能触发回归。

    允许跨项目（执行时按项目拆成多个 run），不允许跨团队。
    """

    name: str = Field(min_length=1, max_length=128)
    feature_ids: list[uuid.UUID] = Field(min_length=1)
    iteration_id: uuid.UUID | None = None
    tag_ids: list[uuid.UUID] = []
    retry_count: int = Field(default=0, ge=0, le=5)
    run_now: bool = True


# ------------------------------------------------------------------------- 执行


class CaseResultOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    test_case_id: uuid.UUID | None
    source_path: str | None
    name: str | None
    case_index: int
    status: str
    attempt_count: int
    passed_after_retry: bool


class RunOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    task_id: uuid.UUID | None
    team_id: uuid.UUID
    project_id: uuid.UUID | None
    iteration_id: uuid.UUID | None
    status: str
    midscene_status: str | None
    exit_code: int | None
    started_at: datetime | None
    ended_at: datetime | None
    duration_ms: int | None
    total: int | None
    passed: int | None
    failed: int | None
    not_run: int | None
    passed_after_retry: int | None
    final_pass_rate: float | None
    first_pass_rate: float | None
    model_name: str | None
    error_message: str | None
    failure_kind: str | None = None


class RunProgressOut(BaseModel):
    done: int = 0
    total: int = 0
    percent: int = 0


class RunDetailOut(RunOut):
    """run 详情。后面这几个字段不是 runs 表的列，是接口现算的派生值，
    给默认值是为了让 model_validate(run) 能直接吃 ORM 对象，再由路由覆盖。"""

    work_dir: str | None = None
    report_available: bool = False
    ai_calls: int = 0
    ai_total_tokens: int = 0
    ai_cost_ms: int = 0
    progress: RunProgressOut = Field(default_factory=RunProgressOut)


class RunListOut(BaseModel):
    items: list[RunOut]
    total: int


# --------------------------------------------------------------------- 执行批次


class BatchFeatureOut(BaseModel):
    """批次里某个功能的测试状态 —— 执行记录每行要展示的多个功能。"""

    feature_id: str
    name: str
    stage: str
    total: int
    passed: int
    failed: int


class BatchOut(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID | None = None
    # 上游测试任务：执行记录要能直接回答「这是哪个任务、任务里有什么」
    task_name: str | None = None
    task_type: str | None = None
    task_status: str | None = None
    task_feature_count: int = 0
    task_case_count: int = 0
    # 最近一次 AI 评估的结论（列表上直接展示，免得点进去才知道）
    ai_status: str | None = None
    ai_verdict: str | None = None
    team_id: uuid.UUID
    team_name: str | None = None
    iteration_id: uuid.UUID | None = None
    name: str
    trigger: str
    created_at: datetime
    # 执行人（批次创建者），合规报告要写清楚是谁触发/执行了这次测试
    created_by_name: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_ms: int = 0
    runs: int = 0
    project_count: int = 0
    total: int = 0
    passed: int = 0
    failed: int = 0
    # 因非用例原因（模型额度/配置/网络）被排除在统计之外的 run 数
    excluded_runs: int = 0
    status: str
    features: list[BatchFeatureOut] = []


class BatchRunOut(BaseModel):
    """批次下的单个 run —— 一次 midscene 执行，只属于一个项目。"""

    id: uuid.UUID
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    status: str
    total: int | None = None
    passed: int | None = None
    failed: int | None = None
    duration_ms: int | None = None
    model_name: str | None = None
    failure_kind: str | None = None
    report_available: bool = False
    started_at: datetime | None = None
    shard_index: int | None = None
    shard_count: int | None = None


class BatchDetailOut(BatchOut):
    run_items: list[BatchRunOut] = []


class BatchListOut(BaseModel):
    items: list[BatchOut]
    total: int


# ------------------------------------------------------------- 人工签名 / webhook 配置


class SignoffInfo(BaseModel):
    model_config = ORM
    id: uuid.UUID
    case_hash: str
    case_count: int
    note: str | None
    signed_at: datetime
    signed_by: UserOut | None = None


class TaskSignoffOut(BaseModel):
    signed: bool
    # 签名时的用例集和现在对不上（有人改了用例/改了任务用例集）—— 签名不能再当有效
    stale: bool
    current_case_count: int
    signoff: SignoffInfo | None = None


class BatchSignoffInfo(BaseModel):
    id: uuid.UUID
    report_hash: str
    case_count: int
    passed: int
    failed: int
    note: str | None = None
    signed_at: datetime
    signed_by_name: str | None = None


class BatchSignoffOut(BaseModel):
    """某一次执行记录的报告签章状态。"""

    signed: bool
    stale: bool
    report_available: bool
    report_hash: str | None = None
    can_sign: bool = False
    signoff: BatchSignoffInfo | None = None


class SignoffIn(In):
    note: str | None = Field(default=None, max_length=500)


class WebhookOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    url: str
    events: list[str]
    include_yaml: bool
    is_active: bool
    # 密钥只回「设没设」，永不回原文
    secret_set: bool
    created_by: uuid.UUID | None = None
    created_at: datetime
    last_delivery_at: datetime | None = None
    last_delivery_status: str | None = None


class WebhookCreate(In):
    name: str = Field(min_length=1, max_length=128)
    url: str = Field(min_length=8, max_length=500)
    secret: str = Field(min_length=8, max_length=255)
    events: list[str] = Field(min_length=1)
    include_yaml: bool = False
    is_active: bool = True


class WebhookUpdate(In):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    url: str | None = Field(default=None, min_length=8, max_length=500)
    # 传了就是换密钥；不传保持原样
    secret: str | None = Field(default=None, min_length=8, max_length=255)
    events: list[str] | None = None
    include_yaml: bool | None = None
    is_active: bool | None = None


class WebhookDeliveryOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    event: str
    status: str
    attempts: int
    response_status: int | None
    response_snippet: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class SettingsOut(BaseModel):
    max_concurrent_runs: int
    run_shard_size: int
    ai_assess_failures_only: bool = False
    updated_at: datetime | None = None


class SettingsIn(In):
    """并发是全局上限；分片大小 0 表示一个项目一个 run，不分片。"""

    # 两个字段都是可选的：只改其中一个时不用把另一个也带上
    max_concurrent_runs: int | None = Field(default=None, ge=1, le=32)
    run_shard_size: int | None = Field(default=None, ge=0, le=50)
    ai_assess_failures_only: bool | None = None


class AiCheckOut(BaseModel):
    """AI 结论的统一形状：执行评估 / 签名预检 / 团队复盘共用。"""

    status: str
    verdict: str | None = None
    summary: str | None = None
    reasons: list[str] = []
    advice: list[str] = []
    # 执行评估的逐条失败诊断：{case, cause, owner: case|product|env, action}
    diagnoses: list[dict] = []
    # 团队复盘是整段 Markdown
    markdown: str | None = None
    model_name: str | None = None
    error: str | None = None
    created_at: datetime | None = None


MeOut.model_rebuild()
RunDetailOut.model_rebuild()
