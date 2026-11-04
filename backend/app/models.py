"""SQLAlchemy 模型。

两条贯穿全表的约定：

1. 枚举一律用 text + CHECK，不用 PostgreSQL 原生 enum —— 原生 enum 的 ALTER TYPE
   不能在事务里执行，以后加一个状态值会卡住迁移。
2. 执行域（runs / case_results / ai_calls）全部是 midscene 产物的投影副本，权威在
   产物文件本身，所以允许 reparse 覆盖重建。
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def _in(column: str, *values: str) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({joined})"


# --------------------------------------------------------------------------- 组织域


class Team(Timestamped, Base):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)

    # passive_deletes=True：删团队时让数据库靠 ON DELETE CASCADE 清理 team_members，
    # 不要让 ORM 去把 team_id 置 NULL（team_id 非空，会直接 500）
    members: Mapped[list["TeamMember"]] = relationship(
        back_populates="team", passive_deletes=True
    )


class User(Timestamped, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 内置卡通头像的标识（前端那份预设里的 key）。不做上传，只存 key；
    # 为空时前端回退到「首字母」头像。
    avatar: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_members"),
        CheckConstraint(_in("role", "owner", "admin", "member"), name="ck_team_members_role"),
        Index("ix_team_members_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    team: Mapped[Team] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Project(Timestamped, Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_projects_team_name"),
        CheckConstraint(_in("status", "active", "archived"), name="ck_projects_status"),
        Index("ix_projects_team", "team_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str | None] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    # 注入 midscene config 的 variables.BASE_URL，让 YAML 里能写 gotoUrl: ${BASE_URL}
    base_url: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")

    # passive_deletes：删项目时让数据库的 ON DELETE CASCADE 清理配置行，
    # 不要让 ORM 去把 project_id 置 NULL（非空列，会 500）
    model_config: Mapped["ProjectModelConfig | None"] = relationship(
        back_populates="project", uselist=False, passive_deletes=True
    )


class ProjectModelConfig(Timestamped, Base):
    """项目级的 midscene 模型配置，覆盖 runner/.env 里的全局值。

    语义是**逐字段覆盖**：只填了模型名就用全局的 key，全部留空就等于没配。
    一行都不存在（project_id 无对应行）表示该项目完全走全局配置。

    关于密钥：这一版明文存库。和 runner/.env 里的明文 key 是同一级别的保护
    （能读库的人通常也能读文件系统），所以加密带来的实际收益有限，但代价是
    引入密钥管理。约束是硬的：**api_key 绝不进任何 API 响应、绝不进日志**，
    对外只暴露 api_key_set 布尔值。
    """

    __tablename__ = "project_model_configs"

    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    model_name: Mapped[str | None] = mapped_column(String(128))
    model_family: Mapped[str | None] = mapped_column(String(64))
    base_url: Mapped[str | None] = mapped_column(String(512))
    api_key: Mapped[str | None] = mapped_column(String(512))
    init_config_json: Mapped[str | None] = mapped_column(Text)
    # 推理模型（Qwen3.x 这类）默认会把 token 大量花在思考上，实测一次小请求能把
    # max_tokens 烧光并返回 content=null，midscene 直接解析不到结果。NULL = 跟随全局。
    reasoning_enabled: Mapped[bool | None] = mapped_column(Boolean)
    # 每月 token 限额（NULL = 不限）。执行器的 ai_calls + 平台侧 AI 调用都计入。
    # 超出后不再发起新的执行/生成/评估，直到下个月或调高限额。
    token_quota: Mapped[int | None] = mapped_column(BigInteger)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    project: Mapped["Project"] = relationship(back_populates="model_config")


class ProjectModelHealth(Base):
    """系统模型接通的最近一次探测结果（每系统一行，只保留最新）。"""

    __tablename__ = "project_model_health"
    __table_args__ = (
        CheckConstraint(
            _in("status", "healthy", "unhealthy", "unknown"),
            name="ck_project_model_health_status",
        ),
        CheckConstraint(
            _in("source", "periodic", "manual"), name="ck_project_model_health_source"
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    model_name: Mapped[str | None] = mapped_column(String(128))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="periodic")
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class ProjectEnvironment(Timestamped, Base):
    """项目的一套测试环境（地址 + 变量）。

    任务只存环境名；执行时按项目名解析成对应环境。跨项目任务要求每个项目
    都有同名环境，避免「这个项目跑 staging、那个项目跑 prod」的隐性错配。
    """

    __tablename__ = "project_environments"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_project_environments_name"),
        Index("ix_project_environments_project", "project_id"),
        Index(
            "uq_project_environments_default",
            "project_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(512))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class ProjectEnvironmentVariable(Timestamped, Base):
    """环境变量。密钥值在库里是 Fernet 密文，接口只回 value_set。"""

    __tablename__ = "project_environment_variables"
    __table_args__ = (
        UniqueConstraint(
            "environment_id", "key", name="uq_project_environment_variables_key"
        ),
        Index("ix_project_environment_variables_env", "environment_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    environment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project_environments.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    is_secret: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(String(255))


class TeamApiToken(Base):
    """CI 用的测试团队级 token。库里只存 SHA-256，明文只在创建时返回一次。"""

    __tablename__ = "team_api_tokens"
    __table_args__ = (
        Index("ix_team_api_tokens_team", "team_id"),
        CheckConstraint("length(token_hash) = 64", name="ck_team_api_tokens_hash"),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    token_prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    scopes: Mapped[str] = mapped_column(String(64), nullable=False, default="run,read")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Iteration(Timestamped, Base):
    __tablename__ = "iterations"
    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_iterations_team_name"),
        CheckConstraint(
            _in("status", "planned", "active", "released", "archived"),
            name="ck_iterations_status",
        ),
        Index("ix_iterations_team", "team_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="planned")
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)


# ----------------------------------------------------------------------- 功能与用例


class Feature(Timestamped, Base):
    __tablename__ = "features"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_features_project_name"),
        CheckConstraint(
            _in("stage", "in_iteration", "released"), name="ck_features_stage"
        ),
        Index("ix_features_project", "project_id"),
        Index("ix_features_iteration", "iteration_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # 禅道/Jira 里的需求编号，可填多个（逗号分隔）。存原文而不是数组：
    # 用户怎么写的就怎么展示，webhook 里再拆成数组给接收方。
    requirement_ids: Mapped[str | None] = mapped_column(String(255))
    # 唯一权威的分期字段；用例分期由它派生
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="in_iteration")
    iteration_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("iterations.id", ondelete="SET NULL")
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    cases: Mapped[list["TestCase"]] = relationship(
        back_populates="feature", cascade="all, delete-orphan"
    )


class TestCase(Timestamped, Base):
    __tablename__ = "test_cases"
    __table_args__ = (
        UniqueConstraint("feature_id", "name", name="uq_test_cases_feature_name"),
        CheckConstraint(
            "stage_override IS NULL OR " + _in("stage_override", "in_iteration", "released"),
            name="ck_test_cases_stage_override",
        ),
        CheckConstraint(
            "priority IS NULL OR " + _in("priority", "P0", "P1", "P2", "P3"),
            name="ck_test_cases_priority",
        ),
        Index("ix_test_cases_feature", "feature_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    feature_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("features.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # 一个用例 = 一个 midscene YAML 文档（可含多个 cases）
    yaml_content: Mapped[str] = mapped_column(Text, nullable=False)
    # 这条用例是为哪些缺陷补的（禅道/Jira 的 bug 单号，逗号分隔可多个）。
    # 「功能编号」不在这里 —— 用例已经通过 feature_id 唯一归属一个功能，
    # 编号挂在功能上，避免两个真相来源。
    defect_ids: Mapped[str | None] = mapped_column(String(255))
    priority: Mapped[str | None] = mapped_column(String(4))
    # NULL 表示分期跟随所属功能；有值表示单独钉选
    stage_override: Mapped[str | None] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    feature: Mapped[Feature] = relationship(back_populates="cases")

    @property
    def effective_stage(self) -> str:
        """用例的生效分期。派生而非落存，所以功能转正后不可能出现不一致。"""
        return self.stage_override or self.feature.stage

    @property
    def project_id(self) -> uuid.UUID | None:
        """用例本身不存系统，靠 feature 上溯。序列化需要它来判断所属系统的模型配置。"""
        return self.feature.project_id if self.feature else None


class TestCaseVersion(Base):
    """用例的一次内容快照。创建、保存、AI 修复、回滚都会各留一版。"""

    __tablename__ = "test_case_versions"
    __table_args__ = (
        UniqueConstraint("case_id", "version_no", name="uq_test_case_versions_no"),
        CheckConstraint(
            _in("change_source", "create", "manual", "ai_fix", "rollback", "backfill"),
            name="ck_test_case_versions_source",
        ),
        Index("ix_test_case_versions_case", "case_id", "version_no"),
    )

    id: Mapped[uuid.UUID] = _pk()
    case_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    yaml_content: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str | None] = mapped_column(String(4))
    defect_ids: Mapped[str | None] = mapped_column(String(255))
    stage_override: Mapped[str | None] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    change_source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    change_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Tag(Timestamped, Base):
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_tags_team_name"),
        Index("ix_tags_team", "team_id"),
        Index("ix_tags_iteration", "iteration_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[str | None] = mapped_column(String(16))
    iteration_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("iterations.id", ondelete="SET NULL")
    )
    description: Mapped[str | None] = mapped_column(Text)


# ----------------------------------------------------------------------- 任务与回归


class TestTask(Timestamped, Base):
    __tablename__ = "test_tasks"
    __table_args__ = (
        CheckConstraint(
            _in("type", "case_run", "feature_regression", "iteration_regression", "adhoc"),
            name="ck_test_tasks_type",
        ),
        CheckConstraint(
            _in("status", "draft", "queued", "running", "completed", "failed", "cancelled"),
            name="ck_test_tasks_status",
        ),
        CheckConstraint(
            _in("case_selection_mode", "snapshot", "dynamic"),
            name="ck_test_tasks_selection_mode",
        ),
        Index("ix_test_tasks_team", "team_id"),
        Index("ix_test_tasks_status", "status"),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    # 跨项目回归时为 NULL
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(24), nullable=False, default="case_run")
    description: Mapped[str | None] = mapped_column(Text)
    iteration_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("iterations.id", ondelete="SET NULL")
    )
    # draft / queued 由人工设置；running / completed / failed 由 runs 聚合派生
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    case_selection_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="snapshot")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 环境名而不是环境 id：跨项目任务要求每个项目都有同名环境。
    # NULL = 使用各项目的「默认」环境（兼容历史任务）。
    environment_name: Mapped[str | None] = mapped_column(String(64))
    # CI 质量门禁：手动执行不阻断，只影响 /api/ci 的结论
    gate_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 0..1；NULL = 不限制通过率
    gate_min_pass_rate: Mapped[float | None] = mapped_column(Numeric(6, 4))
    gate_fail_on_p0: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    tags: Mapped[list[Tag]] = relationship(secondary="task_tags")
    features: Mapped[list[Feature]] = relationship(secondary="task_features")


class TaskTag(Base):
    __tablename__ = "task_tags"

    task_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class TaskFeature(Base):
    __tablename__ = "task_features"

    task_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    feature_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("features.id", ondelete="CASCADE"), primary_key=True
    )


class TaskCase(Base):
    """任务的用例集合 —— 权威字段，决定执行时暂存哪些 YAML。"""

    __tablename__ = "task_cases"
    __table_args__ = (UniqueConstraint("task_id", "case_id", name="uq_task_cases"),)

    id: Mapped[uuid.UUID] = _pk()
    task_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_tasks.id", ondelete="CASCADE"), nullable=False
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=False
    )
    # 血缘：这个用例是通过哪个功能被选进来的
    source_feature_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("features.id", ondelete="SET NULL")
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# --------------------------------------------------------------------- 执行域（投影）


class RunBatch(Timestamped, Base):
    """一次任务执行的批次 —— 用户视角的「一次执行」。

    run 是技术粒度：一次 midscene 进程，只能跑一个项目（YAML 里的 base_url 是项目级的），
    所以跨项目的任务会拆成多个 run。用户视角的粒度是「我点了一次执行」，跨项目也是一件事。

    批次就是这两者之间的那一层。执行记录按批次展示，点进去才看到各项目的 run，
    再往下是功能 / 用例 / midscene 报告。不存聚合指标，一律从 runs 现算 ——
    存一份就多一处会不一致的地方。
    """

    __tablename__ = "run_batches"
    __table_args__ = (
        CheckConstraint(
            _in("trigger", "manual", "regression", "rerun", "schedule", "ci"),
            name="ck_run_batches_trigger",
        ),
        Index("ix_run_batches_team", "team_id"),
        Index("ix_run_batches_task", "task_id"),
        Index("ix_run_batches_parent", "parent_batch_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_tasks.id", ondelete="SET NULL")
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    iteration_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("iterations.id", ondelete="SET NULL")
    )
    # 任务名的快照：任务改名或删除后，历史执行记录还要能显示当时叫什么
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    # 重跑失败时指向源批次；定时/CI 触发来源也靠 trigger 区分
    parent_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("run_batches.id", ondelete="SET NULL")
    )
    # 环境名快照：环境改名/删除后历史批次仍能显示当时跑的是什么
    environment_name: Mapped[str | None] = mapped_column(String(64))
    # CI token 触发的批次留审计线索；用户手动触发为 NULL
    created_by_token_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("team_api_tokens.id", ondelete="SET NULL")
    )
    # 门禁结果在批次收尾时固化一次；之后任务配置变化不影响历史结论
    gate_status: Mapped[str | None] = mapped_column(String(16))
    gate_detail: Mapped[dict | None] = mapped_column(JSONB)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # 批次完成通知只发一次：并行槽位下，最后两个 run 可能同时看到「全部终态」。
    # 用一条带条件的 UPDATE 认领通知权，谁把 NULL 改成时间戳谁负责发。
    completed_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    runs: Mapped[list["Run"]] = relationship(
        back_populates="batch", passive_deletes=True
    )


class TaskSchedule(Timestamped, Base):
    """任务的一条定时回归计划（每个任务最多一条）。"""

    __tablename__ = "task_schedules"
    __table_args__ = (
        CheckConstraint(
            _in("last_status", "queued", "skipped_overlap", "failed"),
            name="ck_task_schedules_last_status",
        ),
        Index("ix_task_schedules_due", "enabled", "next_run_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    task_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("test_tasks.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    cron: Mapped[str] = mapped_column(String(64), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Shanghai")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("run_batches.id", ondelete="SET NULL")
    )
    last_status: Mapped[str | None] = mapped_column(String(24))
    last_error: Mapped[str | None] = mapped_column(Text)
    overlap_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class Run(Timestamped, Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(
            _in(
                "status",
                "queued",
                "preparing",
                "running",
                "parsing",
                "succeeded",
                "failed",
                "cancelled",
                "timed_out",
            ),
            name="ck_runs_status",
        ),
        Index("ix_runs_team", "team_id"),
        Index("ix_runs_project", "project_id"),
        Index("ix_runs_task", "task_id"),
        Index("ix_runs_batch", "batch_id"),
        Index("ix_runs_status", "status"),
        Index("ix_runs_started", "started_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_tasks.id", ondelete="SET NULL")
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL")
    )
    # 用户视角的「一次执行」。跨项目的任务会拆成多个 run，它们共享同一个 batch。
    # 这一层是后加的，历史 run 没有 batch，所以可空。
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("run_batches.id", ondelete="SET NULL")
    )
    # 快照：执行时归属的迭代
    iteration_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("iterations.id", ondelete="SET NULL")
    )
    # 环境快照：id 用于追溯，name/base_url 用于环境被改名/删除后仍可读
    environment_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("project_environments.id", ondelete="SET NULL")
    )
    environment_name: Mapped[str | None] = mapped_column(String(64))
    environment_base_url: Mapped[str | None] = mapped_column(String(512))

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    # 认领这个 run 的 worker 进程。多 worker 下用来判断「原 worker 是否还活着」，
    # 只有拥有者失联时才允许恢复逻辑把它标失败。
    owner_worker_id: Mapped[str | None] = mapped_column(String(64))
    # 单项目任务分片：这个 run 只跑其中一部分用例；为空表示老数据/不分片
    case_ids: Mapped[list[str] | None] = mapped_column(JSONB)
    shard_index: Mapped[int | None] = mapped_column(Integer)
    shard_count: Mapped[int | None] = mapped_column(Integer)
    midscene_run_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    midscene_status: Mapped[str | None] = mapped_column(String(32))
    # 有失败用例时 exitCode != 0，但执行是成功的 —— 所以只用它做诊断，不用它判成败
    exit_code: Mapped[int | None] = mapped_column(Integer)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    total: Mapped[int | None] = mapped_column(Integer)
    passed: Mapped[int | None] = mapped_column(Integer)
    failed: Mapped[int | None] = mapped_column(Integer)
    not_run: Mapped[int | None] = mapped_column(Integer)
    passed_after_retry: Mapped[int | None] = mapped_column(Integer)
    final_pass_rate: Mapped[float | None] = mapped_column(Numeric(6, 4))
    first_pass_rate: Mapped[float | None] = mapped_column(Numeric(6, 4))
    filtered: Mapped[int | None] = mapped_column(Integer)
    collection_errors: Mapped[int | None] = mapped_column(Integer)
    project_failures: Mapped[int | None] = mapped_column(Integer)

    work_dir: Mapped[str | None] = mapped_column(Text)
    result_dir: Mapped[str | None] = mapped_column(Text)
    report_html_path: Mapped[str | None] = mapped_column(Text)

    # 模型漂移归因：通过率跳变时用来判断是不是换了模型/配置
    model_name: Mapped[str | None] = mapped_column(String(128))
    env_hash: Mapped[str | None] = mapped_column(String(64))

    error_message: Mapped[str | None] = mapped_column(Text)
    # 非用例本身的原因导致的失败（模型额度用尽、模型服务不可达、执行器崩了）。
    # 这些必须能和「真实的测试失败」区分开 —— 否则上游 429 会让通过率崩掉，
    # 逼人去追根本不存在的 bug。统计口径会把这些 run 排除在通过率之外。
    failure_kind: Mapped[str | None] = mapped_column(String(32))
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    cases: Mapped[list["CaseResult"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    batch: Mapped["RunBatch | None"] = relationship(back_populates="runs")


class CaseResult(Base):
    __tablename__ = "case_results"
    __table_args__ = (
        # 幂等 upsert 键。caseId/documentId 是内容哈希，不能当身份，所以只做去重而非识别
        UniqueConstraint(
            "run_id", "midscene_document_id", "case_index", name="uq_case_results_identity"
        ),
        Index("ix_case_results_run", "run_id"),
        Index("ix_case_results_case", "test_case_id"),
        Index("ix_case_results_status", "status"),
    )

    id: Mapped[uuid.UUID] = _pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    # 靠source_path 的 basename（暂存文件名 = 用例 UUID）反查，解不出则为 NULL
    test_case_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_cases.id", ondelete="SET NULL")
    )
    midscene_document_id: Mapped[str] = mapped_column(String(128), nullable=False)
    midscene_case_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_path: Mapped[str | None] = mapped_column(String(255))
    case_index: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    passed_after_retry: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    run: Mapped[Run] = relationship(back_populates="cases")


class AiCall(Base):
    """ai-profile-stats.log 的逐行投影。用 bigserial，这是高频追加表。"""

    __tablename__ = "ai_calls"
    __table_args__ = (
        Index("ix_ai_calls_run", "run_id"),
        Index("ix_ai_calls_occurred", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE")
    )
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    model: Mapped[str | None] = mapped_column(String(128))
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    cached_input: Mapped[int | None] = mapped_column(Integer)
    cost_ms: Mapped[int | None] = mapped_column(Integer)
    raw: Mapped[str | None] = mapped_column(Text)


class CaseStability(Base):
    """每次 run 进终态后增量刷新的用例稳定性汇总。

    flaky 是这套系统的核心产品指标：AI 执行器同一个用例时过时不过，需要被显式看见
    而不是被平均掉。
    """

    __tablename__ = "case_stability"

    test_case_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("test_cases.id", ondelete="CASCADE"),
        primary_key=True,
    )
    runs_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    flaky: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_status: Mapped[str | None] = mapped_column(String(32))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


# ------------------------------------------------------------- 人工签名 / webhook 投递


class TaskSignoff(Base):
    """任务的人工签名 —— 证明「这批用例有人审过、认可了」。

    签的是**内容指纹**，不是一句「某人点过按钮」：算的是签名那一刻任务用例集的
    sha256（用例 id + 名称 + YAML + 所属功能）。注意任务里的用例是按引用存的、
    内容并不冻结（执行时读用例的最新 YAML），所以用例被改之后指纹必然对不上 ——
    那时签名要显示成「内容已变更」，而不是继续装作有效。
    """

    __tablename__ = "task_signoffs"
    __table_args__ = (Index("ix_task_signoffs_task", "task_id"),)

    id: Mapped[uuid.UUID] = _pk()
    task_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("test_tasks.id", ondelete="CASCADE"), nullable=False
    )
    case_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    signed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    signed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # 撤回留痕：不删记录，只打时间戳
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class BatchReportSignoff(Base):
    """执行报告的电子签章 —— 面向合规留存的「盖章」记录。

    签的是**某一次执行记录**的报告文件指纹，不是整个任务的用例集；同一条任务
    的多次执行要分别签章。报告重新生成后内容变了，指纹对不上，签章自动失效。
    """

    __tablename__ = "batch_report_signoffs"
    __table_args__ = (Index("ix_batch_report_signoffs_batch", "batch_id"),)

    id: Mapped[uuid.UUID] = _pk()
    batch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("run_batches.id", ondelete="CASCADE"), nullable=False
    )
    report_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # 签章时的结果快照：报告文件被清理后，留存记录仍能说明当时签的是什么
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    signed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    signed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class Webhook(Timestamped, Base):
    """测试团队级的 webhook 配置 —— 形如 GitLab：一个地址勾选订阅哪些事件。"""

    __tablename__ = "webhooks"
    __table_args__ = (
        Index("ix_webhooks_team", "team_id"),
        CheckConstraint(
            _in("kind", "generic", "wecom", "feishu", "dingtalk", "slack"),
            name="ck_webhooks_kind",
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # generic 是原样 POST + HMAC；其余是企业IM机器人，发送时按渠道渲染 body
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="generic")
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # 明文存：HMAC 验签必须拿到原文，没法像 API Key 那样只存哈希。
    # 保护级别等同于数据库本身 —— 接口只回 secret_set，绝不回原文。
    # 企业 IM 渠道的 URL 自带凭据，secret 可为空（钉钉/飞书可选签名）。
    secret: Mapped[str | None] = mapped_column(String(255))
    events: Mapped[str] = mapped_column(String(255), nullable=False)
    # 用例一多，YAML 正文能把 payload 顶到几百 KB，默认不发
    include_yaml: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class WebhookDelivery(Base):
    """一次投递记录。

    payload 在入队时就固化成 jsonb —— 重试必须发同一份字节，否则接收方按 body
    验签会失败（重新构造一遍 payload，只要有一个字段变了签名就废了）。
    """

    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        Index("ix_webhook_deliveries_due", "status", "next_attempt_at"),
        Index("ix_webhook_deliveries_hook", "webhook_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    webhook_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("webhooks.id", ondelete="CASCADE"), nullable=False
    )
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_snippet: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ------------------------------------------------------------------------ AI 结论


class AiCheck(Base):
    """AI 在某个人工节点上给出的结论（评估执行结果 / 签名前预检 / 团队复盘）。

    这张表同时当**任务队列**用：worker 在批次收尾时插一条 ``pending``，
    API 进程里的轮询协程认领它、调模型、写回结论 —— 不占那个串行跑测试的 worker。

    结论只做**建议**，从不阻断任何操作（签名/执行照常可继续）；留着记录是为了事后能
    追溯「当时 AI 说了什么」。
    """

    __tablename__ = "ai_checks"
    __table_args__ = (
        Index("ix_ai_checks_entity", "entity_type", "entity_id"),
        Index("ix_ai_checks_due", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    # batch（执行结果评估）/ task（签名前预检）/ team（团队复盘）
    entity_type: Mapped[str] = mapped_column(String(16), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # healthy / risky / needs_attention；团队复盘这类纯文本结论为 None
    verdict: Mapped[str | None] = mapped_column(String(24))
    summary: Mapped[str | None] = mapped_column(Text)
    # 结构化明细：reasons / advice / markdown …
    detail: Mapped[dict | None] = mapped_column(JSONB)
    model_name: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AiTokenUsage(Base):
    """平台侧 AI 调用的 token 流水（生成用例 / 执行评估 / 预检 / 团队复盘）。

    执行器自己的 token 在 ai_calls 里 —— 两边按项目汇总成「当月用量」，
    和项目配置里的 token_quota 比较。只记流水不记余额：余额是算出来的，
    存一份就多一处会不一致的地方。
    """

    __tablename__ = "ai_token_usage"
    __table_args__ = (
        Index("ix_ai_token_usage_project_time", "project_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    # case_draft / assess / precheck / team_review / model_test
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AppSetting(Base):
    """全局运行时设置（永远只有 id=1 这一行）。

    max_concurrent_runs 是**全局**并发上限：所有 worker 加起来最多同时跑这么多
    run。每个 worker 自己还有槽位数（WORKER_CONCURRENCY 环境变量），但真正领活
    前会在数据库里检查这个全局上限。
    run_shard_size 是单项目任务的分片粒度：一个项目下的用例按这个数量拆成多个
    run；0 表示不分片（保持一个项目一个 run）。
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    max_concurrent_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    run_shard_size: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    # 全部通过的批次是否还要调模型评估：AI 评估每次都是一笔真实成本。
    # 默认关闭 —— 全绿批次用「全部通过」卡片展示，不需要模型再说一遍。
    ai_assess_failures_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class WorkerHeartbeat(Base):
    """worker 进程心跳。每个进程一行，启动注册，退出删除，运行中每 10 秒更新。

    恢复逻辑只处理「心跳过期」的 worker 名下的 run —— 否则新 worker 一启动就会
    把其他 worker 正在跑的测试全部标失败（这是多 worker 水平扩容的硬前提）。
    """

    __tablename__ = "worker_heartbeats"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    hostname: Mapped[str | None] = mapped_column(String(255))
    pid: Mapped[int | None] = mapped_column(Integer)
    slots: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
