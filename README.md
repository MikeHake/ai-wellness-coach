# AI Wellness Coach

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

## Development process

Work is tracked as GitHub issues (user stories and tech tasks), grouped into milestones by roadmap phase. Each change lands through a pull request that references its issue (`Closes #N`) and passes CI.

## License

[MIT](LICENSE)
