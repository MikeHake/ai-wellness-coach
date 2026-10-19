# AI Wellness Coach

[![CI](https://github.com/MikeHake/ai-wellness-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeHake/ai-wellness-coach/actions/workflows/ci.yml)

Log food, movement, and sleep in plain English, and above all how you felt. An AI agent turns each sentence into structured data and helps you discover what leaves you feeling your best.

> "I went for a 3-hour mountain bike ride with a friend and felt great."
>
> "Did a CrossFit class tonight and felt sluggish."

**Live:** web app https://ai-wellness-coach.pages.dev, API https://ai-wellness-coach-api.mikehake.workers.dev/health

**Status:** Phase 1 (Foundation) in progress. See the [milestones](../../milestones) and [issues](../../issues).

## Stack

| Layer      | Choice                                              | Hosting          |
| ---------- | --------------------------------------------------- | ---------------- |
| Frontend   | React + TypeScript, Vite                            | Cloudflare Pages |
| Backend    | Hono on Cloudflare Workers                          | Cloudflare       |
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

`pnpm dev` starts the web app at http://localhost:5173 and the API at http://localhost:3000. Both need the Auth0 and database settings below before they start.

### Auth0

Sign-in uses [Auth0](https://auth0.com) Universal Login. In a free Auth0 tenant:

1. **Applications > Create Application > Single Page Application.** Set Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins to `http://localhost:5173`, and turn on Refresh Token Rotation.
2. **Applications > APIs > Create API.** Use the identifier `https://api.ai-wellness-coach` and RS256, then turn on Allow Offline Access (needed for refresh tokens). On the API's **Application Access** tab, edit the Single Page Application and set **User Access** to **Authorized**. Without this, newer tenants reject sign-in with "Client is not authorized to access resource server".
3. **Authentication > Database > Username-Password-Authentication:** turn on Disable Sign Ups, then create your own user under **User Management > Users**.
4. Fill in `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` in `apps/api/.env`, and `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_AUDIENCE` in `apps/web/.env`. These are public identifiers, not secrets; the domain has no `https://`, and the audience must match the API identifier exactly.

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

## Deployment

Merging to `main` releases automatically: CI runs first, then database migrations and the API Worker deploy, then the web app deploys to Cloudflare Pages. If a migration fails, the release stops and the live API keeps running the previous version. Pull requests from this repository get a Pages preview site, with its URL posted as a comment. Previews call the production API.

Where settings live:

| Setting                                               | Where                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Production database URL                               | Cloudflare Hyperdrive (for the API) and the GitHub `production` environment secret `DATABASE_URL` (for migrations) |
| Cloudflare API token and account ID                   | GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`                                       |
| API settings (CORS origin, Auth0 domain and audience) | `apps/api/wrangler.jsonc` (public values)                                                                          |
| Web build settings (`VITE_*`)                         | GitHub repository variables (public values)                                                                        |

One-time setup for a fresh Cloudflare account:

1. Create the Pages project: `pnpm dlx wrangler pages project create ai-wellness-coach --production-branch main`.
2. Create the Hyperdrive config from the Neon **production** branch's direct connection string: `pnpm dlx wrangler hyperdrive create ai-wellness-coach-db --connection-string='...'`, and put the printed id in `apps/api/wrangler.jsonc`.
3. Create a Cloudflare API token with Workers Scripts: Edit and Cloudflare Pages: Edit, then `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`.
4. Create the GitHub `production` environment (deployment branches: `main` only) and `gh secret set DATABASE_URL --env production`.
5. Set the `VITE_API_URL` and `VITE_AUTH0_*` repository variables with `gh variable set`.
6. In Auth0, add `https://ai-wellness-coach.pages.dev` and `https://*.ai-wellness-coach.pages.dev` to the application's callback, logout, and web origin URLs.

To try the Worker locally on Cloudflare's runtime, add `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (the same value as `DATABASE_URL`) to `apps/api/.env` and run `pnpm --filter @ai-wellness-coach/api dev:worker`. Note that wrangler also reads `.env`, so values there override `wrangler.jsonc` locally.

## Development process

Work is tracked as GitHub issues (user stories and tech tasks), grouped into milestones by roadmap phase. Each change lands through a pull request that references its issue (`Closes #N`). CI (lint, format check, typecheck, tests, and build) runs on every pull request and push to `main`, and branch protection on `main` requires a pull request with passing CI before merging.

## License

[MIT](LICENSE)
