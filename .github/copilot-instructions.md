# Project Instructions

- This is a client-side Vite/TypeScript WebMCP and Prompt API demo. The browser page owns the workspace data, signed-in user, and UI state; there is no backend LLM or API-token boundary.
- Preserve the agent safety contract in `src/assistant-system-prompt.md`, `src/data/tools.json`, and `src/prompt-api-service.ts`: classify each request as read-only or mutation, use the task lookup capability before mutations, require exact returned task IDs, treat zero or multiple matches as ambiguity, and never mutate a read-only search. Status and priority are independent fields; a request for one must never invoke or change the other. Bulk changes are allowed only when the user explicitly requests “all” and must update every matched task.
- Keep tool descriptions and schemas rich enough to communicate these rules to the model. Do not move safety decisions into prompt wording alone: enforce input validation and read-only/mutation guards in the tool protocol, registry, and agentic loop as appropriate.
- Keep the architecture boundaries described in `README.md`: `main.ts` only composes application state and services; `tool-registry.ts` owns page tools and execution traces; `tool-protocol.ts` owns schemas, parsing, and validation; `prompt-api-service.ts` owns native model availability, sessions, prompts, retries, and request tracing; `webmcp-service.ts` owns browser tool registration; `render.ts` owns markup; `ui-events.ts` owns human interaction wiring; `mock-api.ts` is the shared local data boundary.
- Prompt request trace entries are created before asynchronous Prompt API work begins. Every create and prompt entry must be completed with either the returned response or an explicit error, including retry and failure paths, so Trace never leaves a request at “Awaiting response…” after the operation finishes.

## Local validation

- Install dependencies with `npm install`.
- Run the type-check and production build with `npm run build`.
- Run the full test suite with `npm test`.
- Run a focused test file with `npx vitest run tests/tool-protocol.test.ts` (replace the path with another file under `tests/` as needed).

## Deployment

- When the user asks to deploy or host this website, publish it to GitHub Pages.
- Do not deploy this project to Azure unless the user explicitly requests Azure.
- Use the existing `.github/workflows/deploy-pages.yml` workflow and GitHub Pages deployment path.
- After every code or documentation change, commit the change, push it to `main`, and verify the GitHub Pages workflow completes successfully.
