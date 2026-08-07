import './style.css'

type Scene = 'overview' | 'activity' | 'settings' | 'debug'
type TaskStatus = 'Todo' | 'In progress' | 'Done'
type DebugLevel = 'info' | 'success' | 'error' | 'pending'

interface Task {
  id: string
  title: string
  owner: string
  status: TaskStatus
  priority: 'High' | 'Medium' | 'Low'
  due: string
}

interface Project {
  name: string
  description: string
  health: 'On track' | 'At risk'
  tasks: Task[]
}

interface ToolCall {
  id: number
  name: string
  input: string
  output: string
  status: 'complete' | 'running'
}

interface LocalTool {
  name: string
  description: string
  input: string
  run: (input: Record<string, string>) => string
}

interface WebMcpContext {
  registerTool: (tool: {
    name: string
    title: string
    description: string
    inputSchema: Record<string, unknown>
    annotations: { readOnlyHint: boolean }
    execute: (input: Record<string, string>) => Promise<unknown>
  }, options?: { signal?: AbortSignal }) => void | Promise<void>
  unregisterTool?: (name: string) => void
}

interface PromptLanguageModel {
  availability?: (options?: Record<string, unknown>) => Promise<string> | string
  create: (options: Record<string, unknown>) => Promise<PromptSession>
}

interface PromptSession {
  prompt: (input: string) => Promise<string>
  destroy?: () => void
}

const project: Project = {
  name: 'Atlas launch',
  description: 'A client-side project workspace. The page owns the data, state, and tools.',
  health: 'On track',
  tasks: [
    { id: 't-1', title: 'Finalize onboarding flow', owner: 'Maya', status: 'In progress', priority: 'High', due: 'Today' },
    { id: 't-2', title: 'Review usage analytics', owner: 'Noah', status: 'Todo', priority: 'Medium', due: 'Tomorrow' },
    { id: 't-3', title: 'Publish release notes', owner: 'Maya', status: 'Done', priority: 'Low', due: 'Aug 09' },
    { id: 't-4', title: 'Run accessibility audit', owner: 'Iris', status: 'Todo', priority: 'High', due: 'Aug 10' },
    { id: 't-5', title: 'Prepare customer demo', owner: 'Noah', status: 'In progress', priority: 'Medium', due: 'Aug 12' },
  ],
}

const state = {
  scene: 'overview' as Scene,
  filter: 'All',
  toolCalls: [] as ToolCall[],
  callId: 0,
  chat: [] as { role: 'user' | 'assistant'; text: string }[],
  promptMode: 'mock' as 'prompt-api' | 'mock',
  webMcpMode: 'mock' as 'webmcp' | 'mock',
  webMcpRegistrationStarted: false,
  webMcpRegistration: 'pending' as 'pending' | 'complete' | 'unavailable' | 'error',
  webMcpRegisteredTools: [] as string[],
  webMcpErrors: [] as string[],
  promptApiAvailable: false,
  promptAvailability: 'checking',
  promptDownload: 'unknown',
  promptSessionState: 'idle' as 'idle' | 'creating' | 'ready' | 'error',
  promptSessionRef: null as PromptSession | null,
  promptDownloadProgress: null as number | null,
  debugLogs: [] as { time: string; level: DebugLevel; message: string; detail?: string }[],
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

function debugLog(level: DebugLevel, message: string, detail?: string) {
  state.debugLogs.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), level, message, detail })
}

const tools: LocalTool[] = [
  {
    name: 'get_project_summary',
    description: 'Read the project health, task counts, and launch context from page-local state.',
    input: '{}',
    run: () => JSON.stringify({ project: project.name, health: project.health, tasks: project.tasks.length, inProgress: project.tasks.filter((task) => task.status === 'In progress').length }),
  },
  {
    name: 'search_tasks',
    description: 'Search the tasks already loaded in this page by title, owner, priority, or status.',
    input: '{ "query": "string" }',
    run: ({ query = '' }) => JSON.stringify(project.tasks.filter((task) => Object.values(task).some((value) => value.toLowerCase().includes(query.toLowerCase())))),
  },
  {
    name: 'get_current_user',
    description: 'Read the signed-in user and permissions from the local session state.',
    input: '{}',
    run: () => JSON.stringify({ name: 'Jordan Lee', role: 'Product lead', permissions: ['read:project', 'update:tasks'], source: 'local session' }),
  },
  {
    name: 'set_task_status',
    description: 'Update a task status in the page-local workspace and return the updated task.',
    input: '{ "taskId": "t-1", "status": "Done" }',
    run: ({ taskId = '', status = 'Todo' }) => {
      const task = project.tasks.find((candidate) => candidate.id === taskId)
      if (!task || !['Todo', 'In progress', 'Done'].includes(status)) return JSON.stringify({ error: 'Task or status not found' })
      task.status = status as TaskStatus
      render()
      return JSON.stringify(task)
    },
  },
]

const toolSchemas: Record<string, Record<string, unknown>> = {
  get_project_summary: { type: 'object', properties: {} },
  search_tasks: { type: 'object', properties: { query: { type: 'string', description: 'Text to match against task fields' } }, required: ['query'] },
  get_current_user: { type: 'object', properties: {} },
  set_task_status: {
    type: 'object',
    properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['Todo', 'In progress', 'Done'] } },
    required: ['taskId', 'status'],
  },
}

const promptTools = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: toolSchemas[tool.name],
  execute: async (input: Record<string, string>) => {
    debugLog('info', `Prompt API requested ${tool.name}`, JSON.stringify(input))
    return invokeTool(tool.name, input)
  },
}))

async function registerWebMcpTools() {
  if (state.webMcpRegistrationStarted) return
  state.webMcpRegistrationStarted = true
  const documentWithModelContext = document as Document & { modelContext?: WebMcpContext }
  const navigatorWithModelContext = navigator as Navigator & { modelContext?: WebMcpContext }
  const modelContext = documentWithModelContext.modelContext || navigatorWithModelContext.modelContext
  const surface = documentWithModelContext.modelContext ? 'document.modelContext' : navigatorWithModelContext.modelContext ? 'navigator.modelContext (legacy)' : 'none'
  debugLog('info', 'WebMCP capability check', `surface=${surface}; secureContext=${window.isSecureContext}`)
  if (!modelContext?.registerTool) {
    state.webMcpRegistration = 'unavailable'
    debugLog('error', 'WebMCP unavailable', 'Enable Chrome WebMCP preview and chrome://flags/#enable-webmcp-testing.')
    return
  }

  const controller = new AbortController()
  const registered = await Promise.all(tools.map(async (tool) => {
    try {
      debugLog('pending', `Registering ${tool.name}`)
      await modelContext.registerTool({
        name: tool.name,
        title: tool.name.replaceAll('_', ' '),
        description: tool.description,
        inputSchema: toolSchemas[tool.name],
        annotations: { readOnlyHint: tool.name !== 'set_task_status' },
        execute: async (input) => JSON.parse(invokeTool(tool.name, input)),
      }, { signal: controller.signal })
      state.webMcpRegisteredTools.push(tool.name)
      debugLog('success', `Registered ${tool.name}`, 'Visible to the browser model context.')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.webMcpErrors.push(`${tool.name}: ${message}`)
      debugLog('error', `Failed to register ${tool.name}`, message)
      console.error(`Failed to register WebMCP tool "${tool.name}"`, error)
      return false
    }
  }))
  if (registered.some(Boolean)) {
    state.webMcpMode = 'webmcp'
    state.webMcpRegistration = state.webMcpErrors.length ? 'error' : 'complete'
    debugLog(state.webMcpErrors.length ? 'error' : 'success', 'WebMCP registration finished', `${state.webMcpRegisteredTools.length}/${tools.length} tools registered.`)
    void registerWebMcpTools()
    void detectPromptApi()
    render()
  }
}

async function detectPromptApi() {
  const languageModel = (globalThis as typeof globalThis & { LanguageModel?: PromptLanguageModel }).LanguageModel
  if (!languageModel) {
    state.promptAvailability = 'unavailable'
    state.promptDownload = 'unavailable'
    debugLog('error', 'Prompt API unavailable', 'The global LanguageModel surface is not exposed in this browser.')
    render()
    return
  }
  state.promptApiAvailable = true
  try {
    const availability = languageModel.availability ? await languageModel.availability(promptSessionOptions()) : 'unknown'
    state.promptAvailability = availability
    state.promptDownload = availability
    debugLog('success', 'Prompt API detected', `LanguageModel.availability()=${availability}`)
  } catch (error) {
    state.promptAvailability = 'error'
    state.promptDownload = 'error'
    debugLog('error', 'Prompt API availability check failed', error instanceof Error ? error.message : String(error))
  }
  render()
}

function promptSessionOptions() {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    tools: promptTools,
  }
}

async function ensurePromptSession() {
  if (state.promptSessionRef) return state.promptSessionRef
  const languageModel = (globalThis as typeof globalThis & { LanguageModel?: PromptLanguageModel }).LanguageModel
  if (!languageModel) throw new Error('LanguageModel is unavailable in this browser.')

  state.promptSessionState = 'creating'
  state.promptDownloadProgress = null
  debugLog('pending', 'Creating Prompt API session', 'This user-initiated call may start downloading the local model.')
  render()
  const options = promptSessionOptions()
  const availability = languageModel.availability ? await languageModel.availability(options) : 'unknown'
  state.promptAvailability = availability
  if (availability === 'unavailable') throw new Error('Prompt API reports this text-and-tools session as unavailable.')

  const session = await languageModel.create({
    ...options,
    initialPrompts: [{ role: 'system', content: 'You are a concise project assistant. Use the page tools when needed. Never invent workspace facts. If a tool is relevant, call it before answering.' }],
    monitor: (monitor: EventTarget) => {
      debugLog('pending', 'Local model download started or is continuing')
      monitor.addEventListener('downloadprogress', (event) => {
        const progress = event as Event & { loaded?: number; total?: number }
        state.promptDownloadProgress = typeof progress.total === 'number' && progress.total > 0 ? progress.loaded! / progress.total : null
        state.promptDownload = 'downloading'
        debugLog('pending', 'Local model download progress', state.promptDownloadProgress === null ? 'progress unavailable' : `${Math.round(state.promptDownloadProgress * 100)}%`)
        render()
      })
    },
  })
  state.promptSessionRef = session
  state.promptSessionState = 'ready'
  state.promptDownload = 'available'
  debugLog('success', 'Prompt API local model session ready', 'The next prompt will run through the native tool-enabled session.')
  render()
  return session
}

function invokeTool(name: string, input: Record<string, string> = {}) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) return 'Tool not found'
  const call: ToolCall = { id: ++state.callId, name, input: JSON.stringify(input), output: 'Running…', status: 'running' }
  state.toolCalls.unshift(call)
  render()
  const output = tool.run(input)
  call.output = output
  call.status = 'complete'
  render()
  return output
}

async function askAgent(message: string) {
 state.chat.push({ role: 'user', text: message })
 render()
 let answer: string
 try {
   const session = await ensurePromptSession()
   debugLog('pending', 'Sending prompt to native local model', message)
   answer = await session.prompt(message)
   state.promptMode = 'prompt-api'
   debugLog('success', 'Prompt API response received', 'Response generated by the native local model.')
 } catch (error) {
   state.promptSessionState = 'error'
   const messageText = error instanceof Error ? error.message : String(error)
   debugLog('error', 'Prompt API request failed', messageText)
   answer = `Prompt API is not available for this request: ${messageText}`
 }
  state.chat.push({ role: 'assistant', text: answer })
  render()
}

function renderTask(task: Task) {
  return `<article class="task-row"><div class="task-title"><span class="status-dot ${task.status.toLowerCase().replace(' ', '-')}"></span><strong>${escapeHtml(task.title)}</strong><span class="tag ${task.priority.toLowerCase()}">${task.priority}</span></div><div class="task-meta"><span>${task.owner}</span><span>${task.due}</span><span class="status-text">${task.status}</span></div></article>`
}

function render() {
  const filteredTasks = state.filter === 'All' ? project.tasks : project.tasks.filter((task) => task.status === state.filter)
  const chat = state.chat.map((message) => `<div class="chat-message ${message.role}"><span class="chat-label">${message.role === 'user' ? 'YOU' : 'LOCAL MODEL'}</span><p>${escapeHtml(message.text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p></div>`).join('')
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="app-shell">
      <header class="topbar"><div class="brand"><span class="brand-mark">✦</span><span>WEB<span class="brand-muted">MCP</span></span><span class="brand-divider">/</span><span class="brand-context">ATLAS WORKSPACE</span></div><div class="top-actions"><span class="live-pill"><i></i> LOCAL-FIRST</span><button class="avatar" aria-label="Open user settings">JL</button></div></header>
      <div class="layout">
        <aside class="sidebar"><div class="side-label">WORKSPACE</div><button class="nav-item ${state.scene === 'overview' ? 'active' : ''}" data-scene="overview"><span>▦</span> Overview</button><button class="nav-item ${state.scene === 'activity' ? 'active' : ''}" data-scene="activity"><span>↗</span> Activity <b>12</b></button><button class="nav-item ${state.scene === 'debug' ? 'active' : ''}" data-scene="debug"><span>⌘</span> Debug</button><button class="nav-item ${state.scene === 'settings' ? 'active' : ''}" data-scene="settings"><span>⚙</span> Settings</button><div class="sidebar-spacer"></div><div class="connection-card"><span class="connection-icon">◉</span><div><strong>Page tools online</strong><small>${tools.length} tools · no backend</small></div></div><div class="user-card"><span class="avatar small">JL</span><div><strong>Jordan Lee</strong><small>Product lead</small></div><span>⌄</span></div></aside>
        <main class="main-content">${state.scene === 'settings' ? renderSettings() : state.scene === 'activity' ? renderActivity() : state.scene === 'debug' ? renderDebug() : renderOverview(filteredTasks)}</main>
        <aside class="agent-panel"><div class="agent-heading"><div><span class="eyebrow">ON-DEVICE ASSISTANT</span><h2>Ask the workspace</h2></div><span class="model-badge">${state.promptMode === 'prompt-api' ? 'PROMPT API' : 'DEMO MODEL'}</span></div><p class="agent-description">The model can discover and call tools exposed by this page. Nothing leaves your browser.</p><div class="chat-log">${chat || '<div class="empty-chat"><span>✦</span><p>Try asking:</p><button class="suggestion">“What is the project health?”</button><button class="suggestion">“Find high priority tasks”</button><button class="suggestion">“Who am I signed in as?”</button></div>'}</div><form class="chat-form" id="chat-form"><input id="chat-input" aria-label="Ask the local model" placeholder="Ask about this workspace…" autocomplete="off"><button aria-label="Send message">↗</button></form></aside>
      </div>
    </div>`
  bindEvents()
}

function renderOverview(tasks: Task[]) {
  const inProgress = project.tasks.filter((task) => task.status === 'In progress').length
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">PROJECT / 08 AUG 2026</span><h1>Good morning, Jordan <span class="wave">⌁</span></h1><p>${project.description}</p></div><button class="primary-button" data-demo="summary">✦ Ask the assistant</button></div><div class="metric-grid"><div class="metric-card"><span class="metric-label">PROJECT HEALTH</span><strong class="metric-value health"><i></i>${project.health}</strong><small>Based on current delivery signals</small></div><div class="metric-card"><span class="metric-label">OPEN TASKS</span><strong class="metric-value">${project.tasks.filter((task) => task.status !== 'Done').length}<em>/ ${project.tasks.length}</em></strong><small>${inProgress} in progress right now</small></div><div class="metric-card"><span class="metric-label">NEXT MILESTONE</span><strong class="metric-value date">AUG 16</strong><small>Public beta launch</small></div></div><div class="section-header"><div><span class="eyebrow">LIVE WORKBOARD</span><h2>Tasks</h2></div><div class="filter-tabs">${['All', 'Todo', 'In progress', 'Done'].map((filter) => `<button class="${state.filter === filter ? 'selected' : ''}" data-filter="${filter}">${filter}</button>`).join('')}</div></div><div class="task-list">${tasks.map(renderTask).join('')}</div></section>`
}

function renderActivity() {
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">WORKSPACE / ACTIVITY</span><h1>What changed</h1><p>A local audit trail keeps the agent's actions inspectable.</p></div></div><div class="activity-list">${state.toolCalls.length ? state.toolCalls.map((call) => `<div class="activity-item"><span class="activity-icon">✦</span><div><strong>${call.name}</strong><p>Page-local tool invoked with ${call.input}</p></div><time>just now</time></div>`).join('') : '<div class="blank-state"><span>↗</span><h2>No tool activity yet</h2><p>Ask the local assistant a question to see the page respond.</p></div>'}</div></section>`
}

function renderDebug() {
  const documentContext = Boolean((document as Document & { modelContext?: WebMcpContext }).modelContext)
  const navigatorContext = Boolean((navigator as Navigator & { modelContext?: WebMcpContext }).modelContext)
  const secure = window.isSecureContext
  const toolTrace = state.toolCalls.map((call) => `<div class="trace-row"><span class="trace-number">${String(call.id).padStart(2, '0')}</span><div><strong>${escapeHtml(call.name)}</strong><small>Input: ${escapeHtml(call.input)} · ${call.status === 'running' ? 'Calling page tool…' : `Returned ${call.output.length} chars`}</small></div><span class="trace-status">${call.status === 'complete' ? '✓' : '…'}</span></div>`).join('')
  const logs = state.debugLogs.map((entry) => `<div class="debug-log ${entry.level}"><time>${entry.time}</time><span class="log-symbol">${entry.level === 'success' ? '✓' : entry.level === 'error' ? '!' : entry.level === 'pending' ? '…' : '·'}</span><div><strong>${escapeHtml(entry.message)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}</div></div>`).join('')
  const status = (value: string, good: boolean) => `<span class="status-chip ${good ? 'good' : 'muted'}">${value}</span>`
  const downloadLabel = state.promptDownloadProgress === null ? state.promptDownload : `${state.promptDownload} ${Math.round(state.promptDownloadProgress * 100)}%`
  return `<section class="content-inner debug-page"><div class="page-header"><div><span class="eyebrow">SYSTEM / DEBUG CONSOLE</span><h1>Runtime diagnostics</h1><p>Everything below is measured in this tab. No server telemetry or external model is involved.</p></div><button class="primary-button" data-action="prepare-model">↥ Prepare local model</button></div><div class="debug-status-grid"><div class="debug-card"><div class="debug-card-heading"><span class="eyebrow">WEBMCP</span>${status(state.webMcpRegistration, state.webMcpRegistration === 'complete')}</div><div class="debug-big">${state.webMcpRegisteredTools.length}<em>/ ${tools.length} tools</em></div><div class="status-line"><span>Secure context</span>${status(secure ? 'yes' : 'no', secure)}</div><div class="status-line"><span>document.modelContext</span>${status(documentContext ? 'available' : 'missing', documentContext)}</div><div class="status-line"><span>navigator.modelContext</span>${status(navigatorContext ? 'available (legacy)' : 'missing', navigatorContext)}</div><div class="status-line"><span>Registration errors</span>${status(String(state.webMcpErrors.length), state.webMcpErrors.length === 0)}</div></div><div class="debug-card"><div class="debug-card-heading"><span class="eyebrow">PROMPT API</span>${status(state.promptAvailability, state.promptApiAvailable)}</div><div class="debug-big">${state.promptSessionState}<em> session</em></div><div class="status-line"><span>LanguageModel</span>${status(state.promptApiAvailable ? 'available' : 'missing', state.promptApiAvailable)}</div><div class="status-line"><span>Model download</span>${status(downloadLabel, state.promptDownload === 'available')}</div><div class="status-line"><span>Last model path</span>${status(state.promptMode === 'prompt-api' ? 'native response' : 'not used', state.promptMode === 'prompt-api')}</div><small class="debug-help">Availability is passive. Use “Prepare local model” or send a prompt to call LanguageModel.create() and begin downloading when needed. The session includes the page tools.</small></div></div><div class="debug-section"><div class="section-header"><div><span class="eyebrow">TOOL INVOCATIONS</span><h2>Execution trace</h2></div><span class="tool-count">${state.toolCalls.length}</span></div><div class="trace-list">${toolTrace || '<div class="trace-empty">No tools called yet</div>'}</div></div><div class="debug-section"><div class="section-header"><div><span class="eyebrow">RUNTIME LOG</span><h2>Prompt API + WebMCP events</h2></div><span class="tool-count">${state.debugLogs.length}</span></div><div class="debug-log-list">${logs || '<div class="trace-empty">Waiting for page diagnostics…</div>'}</div></div></section>`
}

function renderSettings() {
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">WORKSPACE / SETTINGS</span><h1>Local by design</h1><p>These values are deliberately visible: the page owns the data boundary.</p></div></div><div class="settings-grid"><div class="settings-card"><span class="eyebrow">AUTH SESSION</span><h2>Jordan Lee</h2><p>Product lead · signed in locally</p><div class="permission-row"><span>read:project</span><span>update:tasks</span></div></div><div class="settings-card"><span class="eyebrow">BROWSER CAPABILITIES</span><div class="capability"><span class="cap-dot ${state.promptMode === 'prompt-api' ? 'on' : ''}"></span><div><strong>Prompt API</strong><small>${state.promptMode === 'prompt-api' ? 'Available and active' : 'Fallback mode active'}</small></div></div><div class="capability"><span class="cap-dot ${state.webMcpMode === 'webmcp' ? 'on' : ''}"></span><div><strong>WebMCP</strong><small>${state.webMcpMode === 'webmcp' ? 'Tools registered with browser' : 'Demo registry active'}</small></div></div></div></div><div class="architecture-note"><span>⌘</span><div><strong>No backend LLM. No API tokens.</strong><p>Tools run against the state this page already has. In a production browser with WebMCP enabled, the same registry is handed to the browser's model context API.</p></div></div></section>`
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((element) => element.addEventListener('click', () => { state.scene = element.dataset.scene as Scene; render() }))
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((element) => element.addEventListener('click', () => { state.filter = element.dataset.filter!; render() }))
  document.querySelectorAll<HTMLButtonElement>('.suggestion').forEach((element) => element.addEventListener('click', () => askAgent(element.textContent?.replace(/[“”]/g, '') || 'Give me a summary')))
  document.querySelector<HTMLFormElement>('#chat-form')?.addEventListener('submit', (event) => { event.preventDefault(); const input = document.querySelector<HTMLInputElement>('#chat-input'); if (input?.value.trim()) { const value = input.value.trim(); input.value = ''; void askAgent(value) } })
  document.querySelector<HTMLButtonElement>('[data-demo="summary"]')?.addEventListener('click', () => void askAgent('What is the project health?'))
  document.querySelector<HTMLButtonElement>('[data-action="prepare-model"]')?.addEventListener('click', () => { void ensurePromptSession().catch((error) => debugLog('error', 'Local model preparation failed', error instanceof Error ? error.message : String(error))) })
}

void registerWebMcpTools()
void detectPromptApi()
render()
