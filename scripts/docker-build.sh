#!/usr/bin/env bash
# 构建三个镜像（不启动服务）。
#
#   bash scripts/docker-build.sh
#   docker compose up -d
#
# 如果所在网络下容器解析不了 PyPI / npm（企业代理、DNS 受限），在 .env 里设
# BUILD_NETWORK=host 再跑本脚本 —— 它会让 docker build 复用宿主机网络。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

NETWORK_ARGS=()
if [ "${BUILD_NETWORK:-}" = "host" ]; then
  NETWORK_ARGS=(--network host)
  echo "==> 使用 host 网络构建"
fi

echo "==> api"
docker build "${NETWORK_ARGS[@]}" -t aster-qa-api ./backend

echo "==> worker（含 Chromium，首次构建较慢）"
docker build "${NETWORK_ARGS[@]}" -f ./backend/Dockerfile.worker -t aster-qa-worker ./backend

echo "==> web"
docker build "${NETWORK_ARGS[@]}" -t aster-qa-web ./frontend

echo
echo "构建完成。启动：docker compose up -d"
