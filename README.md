# WebMCP / WebAI: client-side agent demo

This is a talk-ready project workspace that demonstrates a different MCP architecture: the page already owns the project data, signed-in user, and UI state, so it exposes those capabilities directly as local tools. A browser-local model can discover the tools, call them, and render an answer without a backend LLM or API token.

## Run it

```bash
npm install
npm run dev
```

Open the local Vite URL. The chat uses the native `LanguageModel` Prompt API only; it does not synthesize answers when the API is unavailable. On the first prompt, or via **Settings → Prepare local model**, the app calls `LanguageModel.create()` with the page tools and a download monitor. In a browser that exposes `document.modelContext.registerTool`, the page registers all five tools at startup.

For Chrome preview testing, use a supported Chrome build, enable the Prompt API/on-device model flags and `chrome://flags/#enable-webmcp-testing`, then reload the HTTPS site. The **Settings** page shows the exact availability, download, session, and registration states; **Trace** contains the runtime event log. See `chrome://on-device-internals` for browser-level model download diagnostics.

### Prompt API temperature and deterministic behavior

The portable web-page Prompt API does not provide a supported `temperature` control. `temperature`, `topK`, and `LanguageModel.params()` are experimental and extension-only, so this demo does not depend on them. Instead, it makes responses more predictable by using fixed system instructions, explicit response-format requirements, stable tool definitions and context, and `responseConstraint` JSON Schema where structured output is required. These techniques reduce variation but do not guarantee identical output across browsers, model versions, or runs.

### Prompt API `kErrorUnknown` retry

Some browser Prompt API builds occasionally return `kErrorUnknown` with `The agentic tool loop could not complete this request`. This is an undocumented browser/model error and does not identify whether the failure came from model availability, context pressure, tool execution, or a browser implementation issue. The app detects this exact error and retries the request once with a fresh Prompt API session. Other errors are surfaced without retrying, and the runtime trace records the retry and final outcome.

## Suggested talk flow

1. Start on **Overview** and point out that tasks, permissions, and health are already in page memory.
2. Ask “What is the project health?” and expand the tool call in **Audit log**: the model chooses `get_project_summary`.
3. Ask “Find high priority tasks”: the page runs the unified `search_tasks` tool against local state and returns the result. The same tool resolves a natural-language task description before a status update.
4. Open **Audit log** to show detailed call metadata, inputs, outputs, timing, and sources, then **Settings** to show the local auth boundary and browser capability status.
5. Open **Trace** to show the runtime event log. The system prompt, WebMCP status, and Prompt API status are available in **Settings**.
6. Explain that unsupported browsers report an explicit capability error; there is no fake assistant response, server-side model, secret, or data replication requirement.

## Architecture

`src/data/` contains the sample workspace, user, application metadata, and conversation starters as JSON fixtures. `src/mock-api.ts` is the shared mock API boundary: the UI reads its project, user, and display metadata through it, while the Prompt API and WebMCP tools use the same boundary for searches and task updates. `src/main.ts` contains the WebMCP registration, native `LanguageModel.availability()`/`create()` session wrapper, and UI. The tool trace is intentionally visible so the demo makes the data boundary clear instead of hiding it inside a chat component.
