# WebMCP / WebAI: client-side agent demo

This is a talk-ready project workspace that demonstrates a different MCP architecture: the page already owns the project data, signed-in user, and UI state, so it exposes those capabilities directly as local tools. A browser-local model can discover the tools, call them, and render an answer without a backend LLM or API token.

## Run it

```bash
npm install
npm run dev
```

Open the local Vite URL. The chat uses the native `LanguageModel` Prompt API only; it does not synthesize answers when the API is unavailable. On the first prompt, or via **Debug → Prepare local model**, the app calls `LanguageModel.create()` with the page tools and a download monitor. In a browser that exposes `document.modelContext.registerTool`, the page registers all four tools at startup.

For Chrome preview testing, use a supported Chrome build, enable the Prompt API/on-device model flags and `chrome://flags/#enable-webmcp-testing`, then reload the HTTPS site. The **Debug** panel shows the exact availability, download, session, and registration states. See `chrome://on-device-internals` for browser-level model download diagnostics.

## Suggested talk flow

1. Start on **Overview** and point out that tasks, permissions, and health are already in page memory.
2. Ask “What is the project health?” and expand **Tool invocations**: the model chooses `get_project_summary`.
3. Ask “Find high priority tasks”: the page runs `search_tasks` against local state and returns the result.
4. Open **Activity** to show the calls are inspectable, then **Settings** to show the local auth boundary and browser capability status.
5. Open **Debug** to show secure-context checks, the active `document.modelContext`/legacy fallback surface, per-tool registration results, Prompt API availability, local model download status, and the full runtime log.
6. Explain that unsupported browsers report an explicit capability error; there is no fake assistant response, server-side model, secret, or data replication requirement.

## Architecture

`src/main.ts` contains the deliberately small vertical slice: typed local state, real WebMCP registration, a native `LanguageModel.availability()`/`create()` session wrapper with tool-enabled prompts and download monitoring, and the UI. The tool trace is intentionally visible so the demo makes the data boundary clear instead of hiding it inside a chat component.
