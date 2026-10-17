#!/usr/bin/env bash
# 构建三个镜像（不启动服务），并打上项目版本号与 latest。
#
#   bash scripts/docker-build.sh
#   bash scripts/docker-release.sh   # 构建 + 推送 Docker Hub
#
# 镜像名：${DOCKERHUB_NAMESPACE:-whalezhao}/aster-qa-{api,worker,web}
# 标签：  <version>、v<version>、latest
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

VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' backend/pyproject.toml | head -1)"
FRONTEND_VERSION="$(sed -n 's/^  "version": "\([^"]*\)",/\1/p' frontend/package.json | head -1)"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "非法版本号：$VERSION" >&2
  exit 1
fi
if [ "$VERSION" != "$FRONTEND_VERSION" ]; then
  echo "版本不一致：backend=$VERSION frontend=$FRONTEND_VERSION" >&2
  exit 1
fi
if [ -n "${ASTER_QA_VERSION:-}" ] && [ "$ASTER_QA_VERSION" != "$VERSION" ]; then
  echo "ASTER_QA_VERSION=$ASTER_QA_VERSION 与项目版本 $VERSION 不一致；请先同步版本" >&2
  exit 1
fi

NAMESPACE="${DOCKERHUB_NAMESPACE:-whalezhao}"
PREFIX="${NAMESPACE}/aster-qa"
TAGS_VERSION=(-t "${PREFIX}-api:${VERSION}" -t "${PREFIX}-api:v${VERSION}")
TAGS_VERSION_WORKER=(-t "${PREFIX}-worker:${VERSION}" -t "${PREFIX}-worker:v${VERSION}")
TAGS_VERSION_WEB=(-t "${PREFIX}-web:${VERSION}" -t "${PREFIX}-web:v${VERSION}")

NETWORK_ARGS=()
if [ "${BUILD_NETWORK:-}" = "host" ]; then
  NETWORK_ARGS=(--network host)
  echo "==> 使用 host 网络构建"
fi

echo "==> 版本 $VERSION，命名空间 $NAMESPACE"

echo "==> api"
docker build "${NETWORK_ARGS[@]}" \
  "${TAGS_VERSION[@]}" -t "${PREFIX}-api:latest" ./backend

echo "==> worker（含 Chromium，首次构建较慢）"
docker build "${NETWORK_ARGS[@]}" \
  -f ./backend/Dockerfile.worker \
  "${TAGS_VERSION_WORKER[@]}" -t "${PREFIX}-worker:latest" ./backend

echo "==> web"
docker build "${NETWORK_ARGS[@]}" \
  "${TAGS_VERSION_WEB[@]}" -t "${PREFIX}-web:latest" ./frontend

echo
echo "构建完成："
echo "  ${PREFIX}-api:${VERSION} (latest)"
echo "  ${PREFIX}-worker:${VERSION} (latest)"
echo "  ${PREFIX}-web:${VERSION} (latest)"
echo "启动：docker compose up -d"
