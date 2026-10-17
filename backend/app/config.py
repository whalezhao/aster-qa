from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://qa:qa@localhost:5432/qa_manage"
    secret_key: str = "dev-only-change-me"
    access_token_expire_minutes: int = 720

    # 逗号分隔。部署到新域名时改这里，不用改代码。
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    runner_dir: str = "runner"
    case_timeout_ms: int = 600_000

    # 执行产物清理：后台协程每 24 小时跑一次
    artifact_cleanup_enabled: bool = True
    artifact_retention_days: int = 30
    artifact_keep_per_task: int = 5

    # worker 心跳超时：超过这个时间没心跳就视为失联，API 的 worker 状态页也用它
    worker_stale_seconds: int = 90

    # 模型健康巡检：默认 30 分钟一次，避免频繁消耗 token
    model_health_enabled: bool = True
    model_health_interval_seconds: int = 1800
    model_health_timeout_seconds: float = 20.0

    # 定时任务轮询间隔
    scheduler_poll_seconds: int = 20

    # 环境变量密钥。留空时从 SECRET_KEY 派生；轮换 SECRET_KEY 前请先单独设置它，
    # 否则已存的环境密钥会解不开。
    environment_secret_key: str = ""
    # 通知里拼报告链接用；留空则只发相对路径
    public_base_url: str = ""

    @property
    def runner_path(self) -> Path:
        p = Path(self.runner_dir)
        return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
