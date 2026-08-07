# WebMCP / WebAI: client-side agent demo

This is a talk-ready project workspace that demonstrates a different MCP architecture: the page already owns the project data, signed-in user, and UI state, so it exposes those capabilities directly as local tools. A browser-local model can discover the tools, call them, and render an answer without a backend LLM or API token.

## Run it

```bash
npm install
npm run dev
```

Open the local Vite URL. The demo works in every modern browser through its deterministic fallback model. In a browser that exposes the Prompt API, the chat automatically attempts the local model and labels the active mode in the assistant panel. In a browser that exposes `navigator.modelContext.registerTool`, the page registers all four tools at startup and the Settings screen reports WebMCP as active. Otherwise, the same registry remains available to the in-page fallback demo.

## Suggested talk flow

1. Start on **Overview** and point out that tasks, permissions, and health are already in page memory.
2. Ask “What is the project health?” and expand **Tool invocations**: the model chooses `get_project_summary`.
3. Ask “Find high priority tasks”: the page runs `search_tasks` against local state and returns the result.
4. Open **Activity** to show the calls are inspectable, then **Settings** to show the local auth boundary and browser capability status.
5. Open **Debug** to show secure-context checks, the active `document.modelContext`/legacy fallback surface, per-tool registration results, Prompt API availability, local model download status, and the full runtime log.
6. Explain that the mock path is only a presentation fallback; the architecture has no server-side model, secret, or data replication requirement.

## Architecture

`src/main.ts` contains the deliberately small vertical slice: typed local state, a tool registry, real `navigator.modelContext.registerTool` calls, a Prompt API capability check, a deterministic fallback agent, and the UI. The tool trace is intentionally visible so the demo makes the data boundary clear instead of hiding it inside a chat component.
