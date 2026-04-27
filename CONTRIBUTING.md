# Contributing

## Before You Start

1. Open an issue first for larger changes.
2. Keep pull requests focused and easy to review.
3. Never commit secrets, `.dev.vars`, or Cloudflare account-specific values.

## Local Development

1. Install dependencies with `bun install`.
2. Copy `.dev.vars.example` to `.dev.vars` and adjust the values.
3. Apply local migrations with `bun run d1:migrate:local`.
4. Build the frontend once with `bun run build:web`.
5. Start the local Worker with `bun run dev:api`.

For UI-only work, you can also use `bun run dev:web`. If you want the Vite dev server to call the local Worker API, set `CORS_ALLOWED_ORIGINS=http://localhost:5173` in `.dev.vars` and `VITE_API_BASE_URL=http://localhost:8787` in `web-vue/.env.local`.

## Verification

Run `bun run build` before opening a pull request.

## Project Layout

- `worker-api/`: Worker API, auth, D1 access, and cron jobs
- `web-vue/`: public pages and dashboard UI
- `worker-shared/contracts/`: shared API and domain types
- `scripts/`: local build and deploy helpers
