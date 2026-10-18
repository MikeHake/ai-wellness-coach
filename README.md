# AI Wellness Coach

[![CI](https://github.com/MikeHake/ai-wellness-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeHake/ai-wellness-coach/actions/workflows/ci.yml)

Log food, movement, and sleep in plain English, and above all how you felt. An AI agent turns each sentence into structured data and helps you discover what leaves you feeling your best.

> "I went for a 3-hour mountain bike ride with a friend and felt great."
>
> "Did a CrossFit class tonight and felt sluggish."

**Status:** Phase 1 (Foundation) in progress. See the [milestones](../../milestones) and [issues](../../issues).

## Stack

| Layer      | Choice                                              | Hosting          |
| ---------- | --------------------------------------------------- | ---------------- |
| Frontend   | React + TypeScript, Vite                            | Cloudflare Pages |
| Backend    | Hono on Node                                        | Fly.io           |
| Database   | Postgres + Drizzle ORM                              | Neon             |
| Auth       | Auth0 (OIDC + PKCE, JWT)                            | Auth0            |
| AI         | Vercel AI SDK + LLM API with tool calling           | Provider-hosted  |
| Validation | Zod schemas shared across web, API, and agent tools |                  |
| Testing    | Vitest + an LLM parsing eval suite in CI            | GitHub Actions   |

## Design

The full design (data model, agent tools, insights approach, and roadmap) lives in [docs/DESIGN.md](docs/DESIGN.md).

Key ideas:

- **The model parses; the code computes.** The agent turns sentences into tool calls; every number comes from the database or shared code, never the model.
- **Confirm before saving.** Every parsed entry appears as a card to save or edit.
- **Feelings are the outcome.** Sleep, food, and movement are inputs; insights compare your best and worst days.
- **Evals in CI.** A suite of example sentences with expected tool calls guards parsing accuracy on every PR.

## Local setup

Prerequisites: [fnm](https://github.com/Schniz/fnm) (a Node version manager) and Node 24. pnpm is installed for you by Corepack, which ships with Node.

```bash
# One-time setup
brew install fnm
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc   # then restart your shell
fnm install 24
corepack enable

# In the repo
fnm use                  # reads .nvmrc
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm dev
```

`pnpm dev` starts the web app at http://localhost:5173 and the API at http://localhost:3000. The web page shows whether it can reach the API's `GET /health` endpoint.

### Database

The API uses Postgres on [Neon](https://neon.com) through Drizzle ORM. Tests do not need it (they use an in-memory Postgres), but running migrations does:

1. Create a Neon project (AWS US East 2, Ohio) with a `development` branch.
2. Copy that branch's **direct** connection string (the host has no `-pooler`) into `apps/api/.env` as `DATABASE_URL`.
3. Run `pnpm db:migrate`.

After changing `apps/api/src/db/schema.ts`, run `pnpm db:generate` and commit the new files in `apps/api/drizzle`. CI fails if they are missing.

### Commands

| Command            | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `pnpm dev`         | Run the web app and the API together               |
| `pnpm build`       | Build every package                                |
| `pnpm test`        | Run all Vitest tests                               |
| `pnpm lint`        | Lint with ESLint                                   |
| `pnpm typecheck`   | Type-check every package                           |
| `pnpm format`      | Format with Prettier (`format:check` to verify)    |
| `pnpm db:generate` | Generate a migration after a schema change         |
| `pnpm db:migrate`  | Apply migrations to the database in `DATABASE_URL` |

### Layout

- `apps/web`: React + Vite app
- `apps/api`: Hono API
- `packages/shared`: Zod schemas and pure logic used by both apps

## Development process

Work is tracked as GitHub issues (user stories and tech tasks), grouped into milestones by roadmap phase. Each change lands through a pull request that references its issue (`Closes #N`). CI (lint, format check, typecheck, tests, and build) runs on every pull request and push to `main`, and branch protection on `main` requires a pull request with passing CI before merging.

## License

[MIT](LICENSE)
