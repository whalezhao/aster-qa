# Contributing

Thanks for taking the time to contribute to Aster QA.

## Development setup

The full local setup is in the [README](README.md#本地开发). In short:

```bash
docker compose up -d postgres
cp backend/.env.example backend/.env
cp backend/runner/.env.example backend/runner/.env
cd backend && uv sync && cd ..
cd frontend && npm ci && cd ..
cd backend/runner && npm ci && npx playwright install chromium && cd ../..
bash scripts/dev.sh
```

## Before opening a pull request

Run the same checks as CI:

```bash
cd backend
uv run ruff check app worker.py scripts tests
uv run pytest -q

cd ../frontend
npm run build
```

If you changed the report parser or the worker, also run a real execution locally
(`测试任务 → 立即执行`) and check the report page, not just the unit tests.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(executions): add per-execution report signoff
fix(reports): keep shard runs in the same retention batch
docs(readme): clarify worker concurrency
```

Keep the subject imperative and concise. Reference an issue in the body when one exists.

## 版本公告（Release notes）

应用的「版本公告」和 `/release-notes` 历史页由代码维护，随前端一起发版，没有后端、数据库或后台界面。
**每次发布里只要有用户可见的新功能、优化或修复，就必须写一条公告。** 内部重构、依赖升级、纯测试改动不写。

发布步骤：

1. 同步版本号：`backend/pyproject.toml`、`frontend/package.json`（锁文件里的项目版本一起改）。
2. 在 `frontend/src/releaseNotes.ts` 的 `RELEASE_NOTES` 数组**最前面**加一条：
   - `version` 必须等于新的 package 版本；`npm run build` 会校验，不一致直接失败。
   - `date` 使用 `YYYY-MM-DD`。
   - 每个用户可见的新功能、优化、修复各写一个 item，`category` 取 `feature` / `improvement` / `fix`；同一版本内按 新功能 → 优化 → 修复 排列。
   - `title` 一句话说清改了什么，`description` 补充使用场景或收益。写给用户看：不写 commit、内部模块名和代码细节。
3. 不修改或删除已发布的历史条目；写错了就追加一条新的说明。
4. 本地运行 `cd frontend && npm run build`，打开应用确认顶栏红点、抽屉和历史页。
5. 按 README 的发布流程构建镜像；`scripts/docker-release.sh` 会再次校验前后端版本一致。

## Pull requests

- Keep changes focused; avoid unrelated refactors.
- Include the user-visible behavior change and how you verified it.
- Add a migration when changing persisted data.
- Do not commit `.env`, model API keys, tokens, execution artifacts, or database dumps.
- For UI changes, include a screenshot or a short recording when practical.

## Reporting security issues

Please do not open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
