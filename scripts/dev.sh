#!/usr/bin/env bash
# 一次起齐四个进程。Ctrl-C 会一起停掉。
#
#   bash scripts/dev.sh
#
# 前置：backend/.env 与 backend/runner/.env 已按各自的 .env.example 填好。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pids=()
cleanup() {
  echo
  echo "==> 停止"
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> PostgreSQL"
docker compose up -d postgres
# 等它真的能连上，否则后端启动就会报连接失败
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U qa -d qa_manage >/dev/null 2>&1; then
    echo "    就绪"
    break
  fi
  sleep 1
done

echo "==> 后端 API :8000"
(cd backend && uv run uvicorn app.main:app --reload --port 8000) &
pids+=($!)

echo "==> 执行 worker（消费执行队列）"
(cd backend && uv run python worker.py) &
pids+=($!)

echo "==> 前端 :5173"
(cd frontend && npm run dev) &
pids+=($!)

echo
echo "打开 http://localhost:5173 登录"
echo "首次使用先建账号："
echo "  cd backend && uv run python seed.py admin admin123 默认团队"
echo
wait
