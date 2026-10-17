#!/usr/bin/env bash
# 构建并推送 Docker Hub 镜像。
#
#   docker login -u <namespace>
#   bash scripts/docker-release.sh            # 使用 pyproject 版本
#   bash scripts/docker-release.sh 0.2.1      # 显式指定版本（必须与项目版本一致）
#
# 推送：
#   <namespace>/aster-qa-api:<version>      + v<version> + latest
#   <namespace>/aster-qa-worker:<version>   + v<version> + latest
#   <namespace>/aster-qa-web:<version>      + v<version> + latest

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PROJECT_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' backend/pyproject.toml | head -1)"
VERSION="${1:-$PROJECT_VERSION}"
if [ "$VERSION" != "$PROJECT_VERSION" ]; then
  echo "版本不一致：参数=$VERSION 项目=$PROJECT_VERSION" >&2
  exit 1
fi
FRONTEND_VERSION="$(sed -n 's/^  "version": "\([^"]*\)",/\1/p' frontend/package.json | head -1)"
if [ "$VERSION" != "$FRONTEND_VERSION" ]; then
  echo "版本不一致：backend=$VERSION frontend=$FRONTEND_VERSION" >&2
  exit 1
fi

NAMESPACE="${DOCKERHUB_NAMESPACE:-whalezhao}"
PREFIX="${NAMESPACE}/aster-qa"

echo "==> 构建 $VERSION 镜像（命名空间 $NAMESPACE）"
ASTER_QA_VERSION="$VERSION" DOCKERHUB_NAMESPACE="$NAMESPACE" \
  bash scripts/docker-build.sh

echo
echo "==> 推送 Docker Hub。如果失败，请先：docker login -u $NAMESPACE"
for image in api worker web; do
  for tag in "$VERSION" "v$VERSION" latest; do
    ref="${PREFIX}-${image}:${tag}"
    echo "==> push $ref"
    docker push "$ref"
  done
done

echo
echo "完成："
echo "  https://hub.docker.com/r/${NAMESPACE}/aster-qa-api"
echo "  https://hub.docker.com/r/${NAMESPACE}/aster-qa-worker"
echo "  https://hub.docker.com/r/${NAMESPACE}/aster-qa-web"
