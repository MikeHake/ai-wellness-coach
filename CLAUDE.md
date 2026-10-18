# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

AI Wellness Coach: users log food, movement, and sleep in plain English, along with how they felt. An AI agent parses each sentence into structured data and helps users discover what leaves them feeling their best.

- The full design (data model, agent tools, insights, roadmap) is in `docs/DESIGN.md`. Read it before starting a feature, and keep it updated when a decision changes.
- Work is tracked in GitHub issues, grouped into milestones by roadmap phase. Issues contain the acceptance criteria; treat them as the spec.
- This is a personal portfolio project that mimics a professional team process. Favor clarity, tests, and clean history over cleverness.

## Stack

- **Monorepo:** pnpm workspaces
- **Frontend:** `apps/web`, React + TypeScript + Vite, deployed to Cloudflare Pages
- **Backend:** `apps/api`, Hono on Node + TypeScript, deployed to Fly.io
- **Shared:** `packages/shared`, Zod schemas, types, and pure logic used by both apps
- **Database:** Postgres on Neon, accessed through Drizzle ORM with drizzle-kit migrations
- **Auth:** Auth0. The SPA uses `@auth0/auth0-react` (authorization code flow with PKCE); the API validates JWT access tokens (signature via JWKS, issuer, audience, expiry)
- **AI:** Vercel AI SDK with tool calling
- **Testing:** Vitest, plus an LLM parsing eval suite in CI (from Phase 2)

Commands are defined in the root `package.json` once issue #1 lands. Expected: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate`.

## Workflow

1. Pick up a GitHub issue. Confirm its acceptance criteria before writing code.
2. Create a branch named `<issue-number>-<short-description>`, for example `6-log-activity`.
3. Make focused commits using Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
4. Run lint, typecheck, and tests before pushing.
5. Open a pull request using the PR template, with `Closes #<issue-number>` in the description, and check off the acceptance criteria that the PR satisfies.
6. CI must pass before merging (branch protection enforces this). Claude reviews new PRs automatically; after pushing fixes, comment `@claude review` for a re-review. The Claude review is advisory, not a required check.
7. Never commit directly to `main`.

## Architecture rules

- **The model parses; the code computes.** The agent turns sentences into tool calls. Every number shown to the user (totals, macros, durations, averages) comes from the database or from code in `packages/shared`, never from model output.
- **Confirm before saving.** Agent write tools (`propose_*`) return drafts; nothing is persisted until the user confirms.
- **One schema, three uses.** Each Zod schema in `packages/shared` drives the agent tool definition, API request validation, and the frontend form or confirmation card. Do not duplicate validation logic.
- **Authorization lives in code.** Every query and tool call is scoped to the authenticated user's id (the JWT `sub` claim). Never trust a user id from the request body, and never give the model raw SQL access.
- **Authenticated routes use `requireAuth` then `requireUser`** (`apps/api/src/auth/middleware.ts`) and read the user id only from `c.var.user.id`. Tests build the app with `createTestApp()` (`apps/api/src/test-support.ts`), which signs tokens with local keys and uses an in-memory database.
- **Timezones matter.** Store timestamps as `timestamptz`. Resolve day boundaries and relative times ("last night", "this morning") using the user's stored timezone, never UTC.
- **Feelings are the outcome.** This app is about how the user feels, not performance. Avoid PRs, streaks, targets, or judgmental language about food or rest.

## Code conventions

- TypeScript strict mode everywhere. Avoid `any`; prefer inferring types from Zod schemas.
- Keep `packages/shared` free of runtime dependencies other than Zod, and keep its logic pure so it is easy to unit test.
- Every API endpoint gets tests, including an authorization test showing one user cannot access another user's data.
- Secrets come from environment variables. Never commit `.env` files or credentials; document new variables in the relevant `.env.example`.

## Writing style

- Never use em dashes in code comments, docs, commit messages, PR descriptions, issues, or UI copy. Use commas, colons, parentheses, or separate sentences instead.
- Keep UI copy warm, encouraging, and plain.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for MikeHake/ai-wellness-coach, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used as-is: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
