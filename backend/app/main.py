import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .ai_review import assess_loop
from .api import (
    ai,
    auth,
    batches,
    cases,
    features,
    iterations,
    projects,
    runs,
    settings,
    stats,
    tags,
    task_runs,
    task_signoff,
    tasks,
    teams,
    users,
    webhooks,
)
from .config import get_settings
from .db import engine
from .migrate import run_migrations
from .retention import cleanup_loop
from .webhook import deliver_loop

log = logging.getLogger("api")
# uvicorn 只配置自己的 logger，root 的级别/处理器不归我们管；直接给 api 这个
# logger 挂一个 handler，请求日志和后台协程的 info 才稳定可见。
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
if not log.handlers:
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False

# 后台协程（retention / ai_review / webhook）用的是各自的 logger，走 root；
# root 默认 WARNING，不调级别的话它们的 info 也会被吞掉。
_root = logging.getLogger()
if not _root.handlers:
    _root.addHandler(_handler)
_root.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # schema 的唯一来源是 migrations/ —— 启动先升到 head，不再用 create_all
    await asyncio.to_thread(run_migrations)
    if len(get_settings().secret_key) < 32:
        # PyJWT 自己也会告警：HMAC-SHA256 的密钥短于 32 字节可被暴力枚举
        log.warning(
            "SECRET_KEY 只有 %d 字节，建议改成 32 字节以上的随机值",
            len(get_settings().secret_key),
        )
    # webhook 投递跟 API 同进程、但独立于请求：签名接口只把投递入队，不等发送。
    # 也不能放进 worker —— 那是串行跑 midscene 的，一次执行可能几十分钟。
    sender = asyncio.create_task(deliver_loop())
    # AI 评估同理：worker 只入队，这里轮询认领、调模型
    assessor = asyncio.create_task(assess_loop())
    # 执行产物按保留策略定期清理（启动先清一次）
    janitor = asyncio.create_task(cleanup_loop())
    yield
    sender.cancel()
    assessor.cancel()
    janitor.cancel()
    await engine.dispose()


app = FastAPI(title="Aster QA", lifespan=lifespan)

_origins = [item.strip() for item in get_settings().cors_origins.split(",") if item.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(teams.router)
app.include_router(projects.router)
app.include_router(iterations.router)
app.include_router(tags.router)
app.include_router(features.router)
app.include_router(cases.router)
app.include_router(tasks.router)
app.include_router(task_runs.router)
app.include_router(task_signoff.router)
app.include_router(runs.router)
app.include_router(batches.router)
app.include_router(stats.router)
app.include_router(webhooks.router)
app.include_router(ai.router)
app.include_router(settings.router)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """每个请求带一个 id：日志、响应头、报错都能串起来。

    客户端可以传 `X-Request-ID` 进来（网关通常有），没有就现场生成一个。
    """
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception(
            "请求异常 id=%s %s %s", request_id, request.method, request.url.path
        )
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    # 报告是 iframe 里的大文件，不刷请求日志
    if not request.url.path.startswith("/reports"):
        log.info(
            "%s %s %s %.0fms id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
    return response


@app.get("/health")
async def health():
    """给监控用：数据库不可用时返回 503，而不是假装健康。"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        log.exception("健康检查：数据库不可用")
        return JSONResponse({"status": "degraded", "db": "down"}, status_code=503)
    return {"status": "ok", "db": "ok"}
