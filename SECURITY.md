# Security Policy

## Supported versions

Aster QA is currently in the `0.x` series. Security fixes are applied to the latest
release on the `main` branch.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** (a private security advisory).
3. Include the affected version/commit, reproduction steps, and impact.

If private advisories are unavailable, contact the maintainers through the GitHub
account shown in the repository metadata.

We will acknowledge the report and coordinate a fix and disclosure timeline.

## Secrets and deployment notes

- `.env` files are gitignored. Never commit model API keys, JWT secrets, database
  passwords, webhook secrets, or execution artifacts.
- The compose defaults are for local development only. Set a strong
  `POSTGRES_PASSWORD` and `SECRET_KEY` before exposing the stack.
- Project model credentials are stored in the database at runtime; they are not
  baked into images or source code.
- Execution reports are served through unguessable UUID paths. If you need stricter
  access control, put the API behind an authenticated reverse proxy and restrict
  `/reports/` and `/api/batches/*/report-assets/` accordingly.
