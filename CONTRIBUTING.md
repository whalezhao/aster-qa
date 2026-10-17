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

## Pull requests

- Keep changes focused; avoid unrelated refactors.
- Include the user-visible behavior change and how you verified it.
- Add a migration when changing persisted data.
- Do not commit `.env`, model API keys, tokens, execution artifacts, or database dumps.
- For UI changes, include a screenshot or a short recording when practical.

## Reporting security issues

Please do not open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
