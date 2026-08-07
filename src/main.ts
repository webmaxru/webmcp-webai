import './style.css'

type Scene = 'overview' | 'activity' | 'settings'
type TaskStatus = 'Todo' | 'In progress' | 'Done'

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
    description: string
    inputSchema: Record<string, unknown>
    execute: (input: Record<string, string>) => Promise<unknown>
  }) => void
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
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
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

function registerWebMcpTools() {
  const modelContext = (navigator as Navigator & { modelContext?: WebMcpContext }).modelContext
  if (!modelContext?.registerTool) return

  const schemas: Record<string, Record<string, unknown>> = {
    get_project_summary: { type: 'object', properties: {} },
    search_tasks: { type: 'object', properties: { query: { type: 'string', description: 'Text to match against task fields' } }, required: ['query'] },
    get_current_user: { type: 'object', properties: {} },
    set_task_status: {
      type: 'object',
      properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['Todo', 'In progress', 'Done'] } },
      required: ['taskId', 'status'],
    },
  }

  tools.forEach((tool) => {
    modelContext.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: schemas[tool.name],
      execute: async (input) => JSON.parse(invokeTool(tool.name, input)),
    })
  })
  state.webMcpMode = 'webmcp'
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

function mockAgent(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('who') || lower.includes('permission') || lower.includes('user')) {
    const user = invokeTool('get_current_user')
    return `You are looking at the workspace as **Jordan Lee**, Product lead. The local session grants ${JSON.parse(user).permissions.join(' and ')}.`
  }
  if (lower.includes('summary') || lower.includes('health') || lower.includes('status')) {
    const summary = JSON.parse(invokeTool('get_project_summary'))
    return `**${summary.project}** is **${summary.health.toLowerCase()}** with ${summary.tasks} tasks. ${summary.inProgress} are currently in progress.`
  }
  const query = message.replace(/find|search|show|which|tasks|task/gi, '').trim() || message
  const matches = JSON.parse(invokeTool('search_tasks', { query }))
  if (!matches.length) return `I searched the page's task data but found no matches for “${query}”.`
  return `I found ${matches.length} matching task${matches.length === 1 ? '' : 's'}: ${matches.map((task: Task) => `**${task.title}** (${task.status}, ${task.owner})`).join(', ')}.`
}

async function askAgent(message: string) {
  state.chat.push({ role: 'user', text: message })
  registerWebMcpTools()
  render()
  let answer = mockAgent(message)
  const promptApi = (globalThis as typeof globalThis & { ai?: { languageModel?: { create: (options: Record<string, unknown>) => Promise<{ prompt: (input: string) => Promise<string> }> } } }).ai?.languageModel
  if (promptApi) {
    try {
      const session = await promptApi.create({ systemPrompt: 'You are a concise project assistant. Use the provided page tools when answering.' })
      answer = await session.prompt(message)
      state.promptMode = 'prompt-api'
    } catch {
      state.promptMode = 'mock'
    }
  }
  state.chat.push({ role: 'assistant', text: answer })
  render()
}

function renderTask(task: Task) {
  return `<article class="task-row"><div class="task-title"><span class="status-dot ${task.status.toLowerCase().replace(' ', '-')}"></span><strong>${escapeHtml(task.title)}</strong><span class="tag ${task.priority.toLowerCase()}">${task.priority}</span></div><div class="task-meta"><span>${task.owner}</span><span>${task.due}</span><span class="status-text">${task.status}</span></div></article>`
}

function render() {
  const filteredTasks = state.filter === 'All' ? project.tasks : project.tasks.filter((task) => task.status === state.filter)
  const toolTrace = state.toolCalls.slice(0, 5).map((call) => `<div class="trace-row"><span class="trace-number">${String(call.id).padStart(2, '0')}</span><div><strong>${call.name}</strong><small>${call.status === 'running' ? 'Calling page tool…' : `Returned ${call.output.length} chars`}</small></div><span class="trace-status">${call.status === 'complete' ? '✓' : '…'}</span></div>`).join('')
  const chat = state.chat.map((message) => `<div class="chat-message ${message.role}"><span class="chat-label">${message.role === 'user' ? 'YOU' : 'LOCAL MODEL'}</span><p>${escapeHtml(message.text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p></div>`).join('')
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="app-shell">
      <header class="topbar"><div class="brand"><span class="brand-mark">✦</span><span>WEB<span class="brand-muted">MCP</span></span><span class="brand-divider">/</span><span class="brand-context">ATLAS WORKSPACE</span></div><div class="top-actions"><span class="live-pill"><i></i> LOCAL-FIRST</span><button class="avatar" aria-label="Open user settings">JL</button></div></header>
      <div class="layout">
        <aside class="sidebar"><div class="side-label">WORKSPACE</div><button class="nav-item ${state.scene === 'overview' ? 'active' : ''}" data-scene="overview"><span>▦</span> Overview</button><button class="nav-item ${state.scene === 'activity' ? 'active' : ''}" data-scene="activity"><span>↗</span> Activity <b>12</b></button><button class="nav-item ${state.scene === 'settings' ? 'active' : ''}" data-scene="settings"><span>⚙</span> Settings</button><div class="sidebar-spacer"></div><div class="connection-card"><span class="connection-icon">◉</span><div><strong>Page tools online</strong><small>${tools.length} tools · no backend</small></div></div><div class="user-card"><span class="avatar small">JL</span><div><strong>Jordan Lee</strong><small>Product lead</small></div><span>⌄</span></div></aside>
        <main class="main-content">${state.scene === 'settings' ? renderSettings() : state.scene === 'activity' ? renderActivity() : renderOverview(filteredTasks)}</main>
        <aside class="agent-panel"><div class="agent-heading"><div><span class="eyebrow">ON-DEVICE ASSISTANT</span><h2>Ask the workspace</h2></div><span class="model-badge">${state.promptMode === 'prompt-api' ? 'PROMPT API' : 'DEMO MODEL'}</span></div><p class="agent-description">The model can discover and call tools exposed by this page. Nothing leaves your browser.</p><div class="chat-log">${chat || '<div class="empty-chat"><span>✦</span><p>Try asking:</p><button class="suggestion">“What is the project health?”</button><button class="suggestion">“Find high priority tasks”</button><button class="suggestion">“Who am I signed in as?”</button></div>'}</div><form class="chat-form" id="chat-form"><input id="chat-input" aria-label="Ask the local model" placeholder="Ask about this workspace…" autocomplete="off"><button aria-label="Send message">↗</button></form><div class="tool-trace"><div class="trace-heading"><span>TOOL INVOCATIONS</span><span class="tool-count">${state.toolCalls.length}</span></div>${toolTrace || '<div class="trace-empty">No tools called yet</div>'}</div></aside>
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

function renderSettings() {
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">WORKSPACE / SETTINGS</span><h1>Local by design</h1><p>These values are deliberately visible: the page owns the data boundary.</p></div></div><div class="settings-grid"><div class="settings-card"><span class="eyebrow">AUTH SESSION</span><h2>Jordan Lee</h2><p>Product lead · signed in locally</p><div class="permission-row"><span>read:project</span><span>update:tasks</span></div></div><div class="settings-card"><span class="eyebrow">BROWSER CAPABILITIES</span><div class="capability"><span class="cap-dot ${state.promptMode === 'prompt-api' ? 'on' : ''}"></span><div><strong>Prompt API</strong><small>${state.promptMode === 'prompt-api' ? 'Available and active' : 'Fallback mode active'}</small></div></div><div class="capability"><span class="cap-dot ${state.webMcpMode === 'webmcp' ? 'on' : ''}"></span><div><strong>WebMCP</strong><small>${state.webMcpMode === 'webmcp' ? 'Tools registered with browser' : 'Demo registry active'}</small></div></div></div></div><div class="architecture-note"><span>⌘</span><div><strong>No backend LLM. No API tokens.</strong><p>Tools run against the state this page already has. In a production browser with WebMCP enabled, the same registry is handed to the browser's model context API.</p></div></div></section>`
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((element) => element.addEventListener('click', () => { state.scene = element.dataset.scene as Scene; render() }))
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((element) => element.addEventListener('click', () => { state.filter = element.dataset.filter!; render() }))
  document.querySelectorAll<HTMLButtonElement>('.suggestion').forEach((element) => element.addEventListener('click', () => askAgent(element.textContent?.replace(/[“”]/g, '') || 'Give me a summary')))
  document.querySelector<HTMLFormElement>('#chat-form')?.addEventListener('submit', (event) => { event.preventDefault(); const input = document.querySelector<HTMLInputElement>('#chat-input'); if (input?.value.trim()) { const value = input.value.trim(); input.value = ''; void askAgent(value) } })
  document.querySelector<HTMLButtonElement>('[data-demo="summary"]')?.addEventListener('click', () => void askAgent('What is the project health?'))
}

render()
