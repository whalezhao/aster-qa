#
# API 服务：FastAPI + Alembic（启动时自动 upgrade head）。
# 不含 Node/Chromium —— 执行器在 worker 镜像里。

FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# pypi.org 在部分内网不通，构建时传国内镜像：--build-arg UV_INDEX_URL=...
ARG UV_INDEX_URL=

# 依赖层单独缓存：只改代码时不用重装依赖
COPY pyproject.toml uv.lock ./
RUN if [ -n "$UV_INDEX_URL" ]; then export UV_INDEX_URL; fi; uv sync --frozen --no-dev --no-install-project

COPY . .
RUN if [ -n "$UV_INDEX_URL" ]; then export UV_INDEX_URL; fi; uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
