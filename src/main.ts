import './style.css'
import assistantSystemPromptTemplate from './assistant-system-prompt.md?raw'
import toolDetails from './data/tools.json'
import { mergeDownloadProgress } from './prompt-download'
import { isUnknownPromptApiError, PROMPT_API_RETRY_LIMIT } from './prompt-retry'
import { getAppData, getCurrentUser, getProject, searchProjectTasks, setProjectTaskPriority, setProjectTaskStatus } from './mock-api'
import { normalizeTaskPriority, normalizeTaskStatus, TASK_PRIORITIES, TASK_STATUSES, type Task } from './task-data'
import { applyBulkTaskStatus, getBulkTaskStatus, getRequestedTaskMutationFields, hasSuccessfulTaskMutation, parseSearchMatches } from './bulk-task-actions'
import { assistantResponseConstraint, normalizeToolInput, parseAssistantResponse, validateToolInput } from './tool-protocol'
import { createAppState, type AppState, type ChatMessage, type DebugLevel, type LocalTool, type PromptApiRequest, type PromptLanguageModel, type PromptSession, type Scene, type ToolCall, type ToolDetails, type WebMcpContext } from './app-types'
import { render as renderView } from './render'

const appData = getAppData()
const currentUser = getCurrentUser()
const project = getProject()

const toolDetailsByName = Object.fromEntries(toolDetails.map((tool) => [tool.name, tool])) as Record<string, ToolDetails>
const state: AppState = createAppState()
let chatRequestTimer: ReturnType<typeof setTimeout> | null = null
let recentSearchMatches: Task[] = []

function debugLog(level: DebugLevel, message: string, detail?: string) {
  state.debugLogs.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), level, message, detail })
}

const tools: LocalTool[] = [
  {
    details: toolDetails[0],
    run: () => JSON.stringify({ project: project.name, health: project.health, tasks: project.tasks.length, inProgress: project.tasks.filter((task) => task.status === 'In progress').length }),
  },
  {
    details: toolDetails[1],
    run: ({ query = '' }) => JSON.stringify({ matches: searchProjectTasks(query) }),
  },
  {
    details: toolDetails[2],
    run: () => JSON.stringify({ ...currentUser, source: 'local session' }),
  },
  {
    details: toolDetails[3],
    run: ({ taskId = '', status = 'Todo' }) => {
      const normalizedStatus = normalizeTaskStatus(status)
      if (!normalizedStatus) return JSON.stringify({ error: `Invalid status. Use one of: ${TASK_STATUSES.join(', ')}` })
      const task = setProjectTaskStatus(taskId, normalizedStatus)
      if (!task) return JSON.stringify({ error: 'Task not found' })
      state.recentlyUpdatedTaskId = task.id
      render()
      window.setTimeout(() => {
        if (state.recentlyUpdatedTaskId === task.id) state.recentlyUpdatedTaskId = undefined
      }, 700)
      return JSON.stringify(task)
    },
  },
  {
    details: toolDetails[4],
    run: ({ taskId = '', priority = 'Medium' }) => {
      const normalizedPriority = normalizeTaskPriority(priority)
      if (!normalizedPriority) return JSON.stringify({ error: `Invalid priority. Use one of: ${TASK_PRIORITIES.join(', ')}` })
      const task = setProjectTaskPriority(taskId, normalizedPriority)
      if (!task) return JSON.stringify({ error: 'Task not found' })
      state.recentlyUpdatedTaskId = task.id
      render()
      window.setTimeout(() => {
        if (state.recentlyUpdatedTaskId === task.id) state.recentlyUpdatedTaskId = undefined
      }, 700)
      return JSON.stringify(task)
    },
  },
]

const promptTools = tools.map((tool) => ({
  name: tool.details.name,
  description: tool.details.description,
  inputSchema: tool.details.inputSchema,
  execute: async (input: Record<string, string>) => {
    debugLog('info', `Prompt API requested ${tool.details.name}`, JSON.stringify(input))
    return invokeTool(tool.details.name, input, 'Prompt API tool execution')
  },
}))

function buildAssistantSystemPrompt() {
  return assistantSystemPromptTemplate.replace('{{PROJECT_NAME}}', project.name)
}

let webMcpReadyPromise: Promise<void> | null = null

function registerWebMcpTools() {
  if (state.webMcpRegistrationStarted) return webMcpReadyPromise ?? Promise.resolve()
  state.webMcpRegistrationStarted = true
  webMcpReadyPromise = (async () => {
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
        debugLog('pending', `Registering ${tool.details.name}`)
        await modelContext.registerTool({
          name: tool.details.name,
          title: tool.details.title,
          description: tool.details.description,
          inputSchema: tool.details.inputSchema,
          annotations: tool.details.annotations,
          execute: async (input) => JSON.parse(invokeTool(tool.details.name, input, 'WebMCP browser execution')),
        }, { signal: controller.signal })
        state.webMcpRegisteredTools.push(tool.details.name)
        debugLog('success', `Registered ${tool.details.name}`, 'Visible to the browser model context.')
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.webMcpErrors.push(`${tool.details.name}: ${message}`)
        debugLog('error', `Failed to register ${tool.details.name}`, message)
        console.error(`Failed to register WebMCP tool "${tool.details.name}"`, error)
        return false
      }
    }))
    if (registered.some(Boolean)) {
      state.webMcpMode = 'webmcp'
      state.webMcpRegistration = state.webMcpErrors.length ? 'error' : 'complete'
      state.webMcpToolCatalog = modelContext.getTools
        ? (await modelContext.getTools()).filter((tool) => state.webMcpRegisteredTools.includes(tool.name))
        : tools.filter((tool) => state.webMcpRegisteredTools.includes(tool.details.name)).map((tool) => ({ name: tool.details.name, description: tool.details.description, inputSchema: tool.details.inputSchema }))
      debugLog('success', 'WebMCP tool catalog loaded', `${state.webMcpToolCatalog.length} tools available to the Prompt API session.`)
      debugLog(state.webMcpErrors.length ? 'error' : 'success', 'WebMCP registration finished', `${state.webMcpRegisteredTools.length}/${tools.length} tools registered.`)
      void detectPromptApi()
      render()
    }
  })()
  return webMcpReadyPromise
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
  const registeredNames = new Set(state.webMcpToolCatalog.map((tool) => tool.name))
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    tools: promptTools.filter((tool) => registeredNames.has(tool.name)),
  }
}

function promptToolRequestDefinitions() {
  const registeredNames = new Set(state.webMcpToolCatalog.map((tool) => tool.name))
  return promptTools
    .filter((tool) => registeredNames.has(tool.name))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema, execute: '[function]' }))
}

function promptApiSettings() {
  return {
    availability: promptSessionOptions(),
    create: {
      ...promptSessionOptions(),
      tools: promptToolRequestDefinitions(),
      initialPrompts: [{ role: 'system', content: buildAssistantSystemPrompt() }],
      monitor: '[function]',
    },
    prompt: {
      responseConstraint: assistantResponseConstraint,
    },
  }
}

function recordPromptRequest(operation: PromptApiRequest['operation'], request: Record<string, unknown>) {
  const entry: PromptApiRequest = { operation, startedAt: Date.now(), request, response: null }
  state.promptRequests.unshift(entry)
  render()
  return entry
}

function recordPromptResponse(entry: PromptApiRequest, response: string) {
  entry.response = response
  render()
}

async function ensurePromptSession() {
  if (state.promptSessionRef) return state.promptSessionRef
  if (state.promptSessionPromise) return state.promptSessionPromise
  const languageModel = (globalThis as typeof globalThis & { LanguageModel?: PromptLanguageModel }).LanguageModel
  if (!languageModel) throw new Error('LanguageModel is unavailable in this browser.')

  await registerWebMcpTools()
  state.promptSessionState = 'creating'
  debugLog('pending', 'Creating Prompt API session', 'This user-initiated call may start downloading the local model.')
  render()
  const options = promptSessionOptions()
  const availability = languageModel.availability ? await languageModel.availability(options) : 'unknown'
  state.promptAvailability = availability
  if (availability === 'unavailable') throw new Error('Prompt API reports this text-and-tools session as unavailable.')
  const modelAlreadyDownloaded = availability === 'available'
  if (modelAlreadyDownloaded) state.promptDownloadProgress = null

  const createOptions = {
    ...options,
    initialPrompts: [{ role: 'system', content: buildAssistantSystemPrompt() }],
    monitor: (monitor: EventTarget) => {
      debugLog('pending', 'Local model download started or is continuing')
      monitor.addEventListener('downloadprogress', (event) => {
        if (modelAlreadyDownloaded) return
        const progress = event as Event & { loaded?: number; total?: number }
        state.promptDownloadProgress = mergeDownloadProgress(state.promptDownloadProgress, progress.loaded, progress.total)
        state.promptDownload = 'downloading'
        render()
      })
    },
  }
  recordPromptRequest('create', promptApiSettings().create)
  state.promptSessionPromise = languageModel.create(createOptions).then((session) => {
    state.promptSessionRef = session
    state.promptSessionState = 'ready'
    state.promptDownload = 'available'
    debugLog('success', 'Prompt API local model session ready', 'The next prompt will run through the native tool-enabled session.')
    render()
    return session
  }).catch((error) => {
    state.promptSessionState = 'error'
    state.promptSessionPromise = null
    debugLog('error', 'Prompt API session creation failed', error instanceof Error ? error.message : String(error))
    render()
    throw error
  })
  return state.promptSessionPromise
}

function invokeTool(name: string, input: Record<string, string> = {}, source = 'Page tool') {
  const tool = tools.find((candidate) => candidate.details.name === name)
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` })
  const normalizedInput = normalizeToolInput(name, input)
  const validationError = validateToolInput(name, normalizedInput)
  if (validationError) {
    debugLog('error', `Rejected invalid ${name} arguments`, validationError)
    return JSON.stringify({ error: validationError, retry: 'Follow the required tool chain and call search_tasks before changing a task.' })
  }
  const statusMessages = tool.details.statusMessages
  const statusMessage: ChatMessage | undefined = statusMessages ? { role: 'status', text: statusMessages.running } : undefined
  if (statusMessage) {
    state.chat.push(statusMessage)
    render()
  }
  const startedAt = Date.now()
  const call: ToolCall = { id: ++state.callId, name, description: tool.details.description, source, input: JSON.stringify(normalizedInput), output: 'Running…', status: 'running', startedAt }
  state.toolCalls.unshift(call)
  render()
  const output = tool.run(normalizedInput)
  call.output = output
  call.status = 'complete'
  call.completedAt = Date.now()
  call.durationMs = call.completedAt - startedAt
  if (statusMessage && statusMessages) statusMessage.text = statusMessages.complete
  render()
  return output
}

async function runAgenticLoop(session: PromptSession, message: string) {
  const promptOptions = { responseConstraint: assistantResponseConstraint }
  const initialRequest = recordPromptRequest('prompt', { input: message, options: promptOptions })
  let response = await session.prompt(message, promptOptions)
  if (isUnknownPromptApiError(response)) throw new Error(response)
  recordPromptResponse(initialRequest, response)
  const registeredNames = new Set(state.webMcpToolCatalog.map((tool) => tool.name))
  const bulkUpdates = new Map<string, Record<string, unknown>>()
  const requestedFields = getRequestedTaskMutationFields(message)
  const requestedMutationField = requestedFields.size === 1 ? [...requestedFields][0] : undefined
  const completedMutationFields = new Set<string>()

  for (let step = 0; step < 8; step += 1) {
    const parsed = parseAssistantResponse(response)
    if (parsed.kind === 'final') {
      if (!requestedMutationField || completedMutationFields.has(requestedMutationField)) return parsed.answer
      const requiredTool = `set_task_${requestedMutationField}`
      const followUp = `You have not completed the user's requested ${requestedMutationField} change. Do not provide a final answer yet. You must call ${requiredTool} with the exact taskId and requested ${requestedMutationField}, then use that tool's returned task data.`
      debugLog('error', 'Blocked final response before required mutation', `No successful ${requiredTool} call was recorded.`)
      const followUpRequest = recordPromptRequest('prompt', { input: followUp, options: promptOptions })
      response = await session.prompt(followUp, promptOptions)
      if (isUnknownPromptApiError(response)) throw new Error(response)
      recordPromptResponse(followUpRequest, response)
      continue
    }
    const toolCall = parsed.toolCall
    if (!registeredNames.has(toolCall.name)) {
      debugLog('error', 'Model requested an unregistered tool', toolCall.name)
      throw new Error(`The model requested "${toolCall.name}", but that tool is not registered on this page.`)
    }

    debugLog('info', `Parsed constrained tool call ${toolCall.name}`, JSON.stringify(toolCall.input))
    const calledMutationField = toolCall.name === 'set_task_status' ? 'status' : toolCall.name === 'set_task_priority' ? 'priority' : undefined
    let result: string
    if (requestedMutationField && calledMutationField && requestedMutationField !== calledMutationField) {
      result = JSON.stringify({
        error: `This request changes only ${requestedMutationField}. Do not call set_task_${calledMutationField}; call set_task_${requestedMutationField} instead.`,
        retry: `Use set_task_${requestedMutationField} with the exact taskId and requested ${requestedMutationField}.`,
      })
      debugLog('error', 'Blocked mutation for the wrong task field', `Requested ${requestedMutationField}, received ${calledMutationField}.`)
    } else {
      const bulkStatus = getBulkTaskStatus(message, recentSearchMatches.length > 0)
      if (toolCall.name === 'set_task_status' && bulkStatus && recentSearchMatches.length > 0 && bulkUpdates.size === 0) {
      const updates = applyBulkTaskStatus(recentSearchMatches, bulkStatus, (taskId, status) => JSON.parse(invokeTool(
        'set_task_status',
        { taskId, status },
        'Prompt API bulk task update',
      )))
      updates.forEach((update) => {
        if (update && typeof update === 'object' && 'id' in update && typeof update.id === 'string') {
          bulkUpdates.set(update.id, update)
        }
      })
      recentSearchMatches = []
      result = JSON.stringify({ updates })
      debugLog('success', 'Completed bulk task status update', `${updates.length} matching task(s) updated to ${bulkStatus}.`)
      } else if (toolCall.name === 'set_task_status' && bulkStatus && bulkUpdates.has(toolCall.input.taskId)) {
        result = JSON.stringify({
          alreadyUpdated: true,
          update: bulkUpdates.get(toolCall.input.taskId),
        })
        debugLog('info', 'Skipped duplicate bulk task status update', toolCall.input.taskId)
      } else {
        result = invokeTool(toolCall.name, toolCall.input, 'Prompt API agentic loop')
      }
      if (toolCall.name === 'search_tasks' && bulkStatus) {
        const matches = parseSearchMatches(result)
        recentSearchMatches = []
        const updates = applyBulkTaskStatus(matches, bulkStatus, (taskId, status) => JSON.parse(invokeTool(
          'set_task_status',
          { taskId, status },
          'Prompt API bulk task update',
        )))
        updates.forEach((update) => {
          if (update && typeof update === 'object' && 'id' in update && typeof update.id === 'string') {
            bulkUpdates.set(update.id, update)
          }
        })
        result = JSON.stringify({ matches, updates })
        debugLog('success', 'Completed bulk task status update', `${updates.length} matching task(s) updated to ${bulkStatus}.`)
      } else if (toolCall.name === 'search_tasks') {
        recentSearchMatches = parseSearchMatches(result)
      }
    }
    if (calledMutationField && hasSuccessfulTaskMutation(result, calledMutationField)) {
      completedMutationFields.add(calledMutationField)
    }
    debugLog('success', `Tool result returned to model`, `${toolCall.name}: ${result}`)
    const followUp = `The page tool "${toolCall.name}" returned this result:
${result}

Use this result to answer the user's original request. For an "all" status request, the result includes an update for every matched task; do not repeat those updates. Otherwise, if another registered tool is required, return a tool_call JSON object; if the request is fully resolved, return a final JSON object.`
    const followUpRequest = recordPromptRequest('prompt', { input: followUp, options: promptOptions })
    response = await session.prompt(followUp, promptOptions)
    if (isUnknownPromptApiError(response)) throw new Error(response)
    recordPromptResponse(followUpRequest, response)
  }

  throw new Error('The agentic tool loop exceeded its eight-step limit.')
}

async function askAgent(message: string) {
 state.chat.push({ role: 'user', text: message })
 render()
 chatRequestTimer = setTimeout(() => {
   state.chatRequestPending = true
   render()
 }, 400)
 let answer: string
 let retryCount = 0
 while (true) {
   try {
     const session = await ensurePromptSession()
     debugLog('pending', 'Sending prompt to native local model', message)
     answer = await runAgenticLoop(session, message)
     state.promptMode = 'prompt-api'
     debugLog('success', 'Prompt API response received', 'Response generated by the native local model.')
     break
   } catch (error) {
     const messageText = error instanceof Error ? error.message : String(error)
     if (isUnknownPromptApiError(error) && retryCount < PROMPT_API_RETRY_LIMIT) {
       retryCount += 1
       state.promptSessionRef?.destroy?.()
       state.promptSessionRef = null
       state.promptSessionPromise = null
       state.promptSessionState = 'idle'
       state.chat.push({ role: 'status', text: 'The local model returned a temporary error. Retrying once…' })
       debugLog('pending', 'Retrying Prompt API request after kErrorUnknown', `Retry ${retryCount}/${PROMPT_API_RETRY_LIMIT}`)
       render()
       continue
     }
     state.promptSessionState = 'error'
     debugLog('error', 'Prompt API request failed', messageText)
     answer = `The agentic tool loop could not complete this request: ${messageText}`
     break
   }
 }
  state.chat.push({ role: 'assistant', text: answer })
  if (chatRequestTimer) clearTimeout(chatRequestTimer)
  chatRequestTimer = null
  state.chatRequestPending = false
  render()
}

function restartConversation() {
  if (chatRequestTimer) clearTimeout(chatRequestTimer)
  chatRequestTimer = null
  state.promptSessionRef?.destroy?.()
  state.promptSessionRef = null
  state.promptSessionPromise = null
  state.promptSessionState = 'idle'
  state.promptMode = 'mock'
  state.chatRequestPending = false
  state.chat = []
  recentSearchMatches = []
  state.toolCalls = []
  state.callId = 0
  debugLog('info', 'Conversation restarted', 'The chat and Prompt API session were reset.')
  render()
}

/*
function renderTask(task: Task) {
  return `<article class="task-row"><div class="task-title"><span class="status-dot ${task.status.toLowerCase().replace(' ', '-')}"></span><strong>${escapeHtml(task.title)}</strong><span class="tag ${task.priority.toLowerCase()}">${task.priority}</span></div><div class="task-meta"><span>${task.owner}</span><span>${task.due}</span><span class="status-text">${task.status}</span></div></article>`
}

function render() {
  const filteredTasks = state.filter === 'All' ? project.tasks : project.tasks.filter((task) => task.status === state.filter)
  const chat = ''
  const starterButtons = conversationStarters.map((starter) => `<button class="starter-pill" type="button" data-prompt="${escapeHtml(starter.prompt)}" title="${escapeHtml(starter.prompt)}">${escapeHtml(starter.label)}</button>`).join('')
  const emptyStarterButtons = conversationStarters.map((starter) => `<button class="starter-pill" type="button" data-prompt-submit="${escapeHtml(starter.prompt)}" title="${escapeHtml(starter.prompt)}">${escapeHtml(starter.prompt)}</button>`).join('')
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="app-shell">
      <header class="topbar"><div class="brand"><span class="brand-mark">✦</span><span>WEB<span class="brand-muted">MCP</span></span><span class="brand-divider">/</span><span class="brand-context">ATLAS WORKSPACE</span></div><div class="top-actions"><span class="live-pill"><i></i> LOCAL-FIRST</span><button class="avatar" aria-label="Open user settings">JL</button></div></header>
      <div class="layout">
        <aside class="sidebar"><div class="side-label">WORKSPACE</div><button class="nav-item ${state.scene === 'overview' ? 'active' : ''}" data-scene="overview"><span>▦</span> Overview</button><button class="nav-item ${state.scene === 'activity' ? 'active' : ''}" data-scene="activity"><span>↗</span> Audit log <b>${state.toolCalls.length}</b></button><button class="nav-item ${state.scene === 'debug' ? 'active' : ''}" data-scene="debug"><span>⌘</span> Trace</button><button class="nav-item ${state.scene === 'settings' ? 'active' : ''}" data-scene="settings"><span>⚙</span> Settings</button><div class="sidebar-spacer"></div><div class="connection-card"><span class="connection-icon">◉</span><div><strong>Page tools online</strong><small>${tools.length} tools · no backend</small></div></div><div class="user-card"><span class="avatar small">${currentUser.initials}</span><div><strong>${currentUser.name}</strong><small>${currentUser.role}</small></div><span>⌄</span></div></aside>
        <main class="main-content">${state.scene === 'settings' ? renderSettings() : state.scene === 'activity' ? renderActivity() : state.scene === 'debug' ? renderDebug() : renderOverview(filteredTasks)}</main>
        <aside class="agent-panel"><div class="agent-heading"><div><span class="eyebrow">ON-DEVICE ASSISTANT</span><h2>Ask the workspace</h2></div><div class="agent-actions"><button class="restart-button" type="button" data-action="restart-conversation" aria-label="New chat" title="New chat">＋</button></div></div><p class="agent-description">The model can discover and call tools exposed by this page. Nothing leaves your browser.</p><div class="chat-log">${chat || `<div class="empty-chat"><span>✦</span><p>Try asking:</p><div class="empty-starters" aria-label="Conversation starters">${emptyStarterButtons}</div></div>`}</div><form class="chat-form" id="chat-form"><input id="chat-input" aria-label="Ask the local model" placeholder="Ask about this workspace…" autocomplete="off"><button aria-label="Send message">↗</button></form><div class="conversation-starters" aria-label="Conversation starters">${starterButtons}</div></aside>
      </div>
    </div>`
  bindEvents()
}

function renderOverview(tasks: Task[]) {
  const inProgress = project.tasks.filter((task) => task.status === 'In progress').length
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">PROJECT / ${appData.dateLabel}</span><h1>Good morning, ${escapeHtml(currentUser.name.split(' ')[0])} <span class="wave">⌁</span></h1><p>${project.description}</p></div></div><div class="metric-grid"><div class="metric-card"><span class="metric-label">PROJECT HEALTH</span><strong class="metric-value health"><i></i>${project.health}</strong><small>Based on current delivery signals</small></div><div class="metric-card"><span class="metric-label">OPEN TASKS</span><strong class="metric-value">${project.tasks.filter((task) => task.status !== 'Done').length}<em>/ ${project.tasks.length}</em></strong><small>${inProgress} in progress right now</small></div><div class="metric-card"><span class="metric-label">NEXT MILESTONE</span><strong class="metric-value date">${appData.nextMilestone}</strong><small>${appData.nextMilestoneLabel}</small></div></div><div class="section-header"><div><span class="eyebrow">LIVE WORKBOARD</span><h2>Tasks</h2></div><div class="filter-tabs">${['All', 'Todo', 'In progress', 'Done'].map((filter) => `<button class="${state.filter === filter ? 'selected' : ''}" data-filter="${filter}">${filter}</button>`).join('')}</div></div><div class="task-list">${tasks.map(renderTask).join('')}</div></section>`
}

function renderActivity() {
  const calls = state.toolCalls.map((call) => `<details class="activity-item tool-call-detail"><summary><span class="activity-icon">✦</span><span><strong>${escapeHtml(call.name)}</strong><p>${escapeHtml(call.description)}</p></span><time>${new Date(call.startedAt).toLocaleTimeString()}</time></summary><div class="tool-call-grid"><div><span class="eyebrow">CALL METADATA</span><p><b>Call ID</b> #${String(call.id).padStart(2, '0')} · <b>Source</b> ${escapeHtml(call.source)} · <b>Status</b> ${call.status}</p><p><b>Started</b> ${new Date(call.startedAt).toLocaleString()}${call.completedAt ? ` · <b>Completed</b> ${new Date(call.completedAt).toLocaleString()}` : ''}${call.durationMs !== undefined ? ` · <b>Duration</b> ${call.durationMs} ms` : ''}</p></div><div><span class="eyebrow">INPUT</span><pre>${escapeHtml(call.input)}</pre></div><div><span class="eyebrow">INPUT SCHEMA</span><pre>${escapeHtml(JSON.stringify(toolDetailsByName[call.name]?.inputSchema ?? {}, null, 2))}</pre></div><div><span class="eyebrow">OUTPUT</span><pre>${escapeHtml(call.output)}</pre><small>${call.output.length} characters returned</small></div></div></details>`).join('')
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">WORKSPACE / AUDIT LOG</span><h1>Tool activity</h1><p>Every page-local tool call is recorded with its source, timing, input, and returned output.</p></div></div><div class="activity-list">${calls || '<div class="blank-state"><span>↗</span><h2>No tool activity yet</h2><p>Ask the local assistant a question to see the page respond.</p></div>'}</div></section>`
}

function renderDebug() {
  const logs = state.debugLogs.map((entry) => `<div class="debug-log ${entry.level}"><time>${entry.time}</time><span class="log-symbol">${entry.level === 'success' ? '✓' : entry.level === 'error' ? '!' : entry.level === 'pending' ? '…' : '·'}</span><div><strong>${escapeHtml(entry.message)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}</div></div>`).join('')
  const requests = state.promptRequests.map((entry) => `<details class="debug-section prompt-request"><summary><span><span class="eyebrow">PROMPT API / ${entry.operation.toUpperCase()}</span><strong>${new Date(entry.startedAt).toLocaleTimeString()} · full request and response</strong></span><span class="tool-count">${entry.operation}</span></summary><div class="prompt-request-payload"><div><span class="eyebrow">REQUEST</span><pre>${escapeHtml(JSON.stringify(entry.request, null, 2))}</pre></div><div><span class="eyebrow">RESPONSE</span><pre>${entry.response === null ? 'Awaiting response…' : escapeHtml(entry.response)}</pre></div></div></details>`).join('')
  return `<section class="content-inner debug-page"><div class="page-header"><div><span class="eyebrow">SYSTEM / TRACE</span><h1>Runtime trace</h1><p>Prompt API and WebMCP lifecycle events are recorded here. Tool call details live in the Audit log.</p></div></div><div class="debug-section"><div class="section-header"><div><span class="eyebrow">RUNTIME LOG</span><h2>Prompt API + WebMCP events</h2></div><span class="tool-count">${state.debugLogs.length}</span></div><div class="debug-log-list">${logs || '<div class="trace-empty">Waiting for page diagnostics…</div>'}</div></div><div class="section-header trace-request-heading"><div><span class="eyebrow">PROMPT API REQUESTS</span><h2>Full request payloads</h2></div><span class="tool-count">${state.promptRequests.length}</span></div>${requests || '<div class="debug-section"><div class="trace-empty">No Prompt API requests yet.</div></div>'}</section>`
}

function renderSettings() {
  const documentContext = Boolean((document as Document & { modelContext?: WebMcpContext }).modelContext)
  const navigatorContext = Boolean((navigator as Navigator & { modelContext?: WebMcpContext }).modelContext)
  const secure = window.isSecureContext
  const status = (value: string, good: boolean) => `<span class="status-chip ${good ? 'good' : 'muted'}">${value}</span>`
  const downloadLabel = state.promptDownloadProgress === null ? state.promptDownload : `${state.promptDownload} ${Math.round(state.promptDownloadProgress * 100)}%`
  const progressMarkup = state.promptDownload === 'downloading' ? `<div class="download-progress"><div class="download-progress-bar" style="width:${state.promptDownloadProgress === null ? '35' : Math.round(state.promptDownloadProgress * 100)}%"></div></div>` : ''
  return `<section class="content-inner"><div class="page-header"><div><span class="eyebrow">WORKSPACE / SETTINGS</span><h1>Local by design</h1><p>These values are deliberately visible: the page owns the data boundary.</p></div><button class="primary-button" data-action="prepare-model">↥ Prepare local model</button></div><div class="settings-grid"><div class="settings-card"><span class="eyebrow">AUTH SESSION</span><h2>${currentUser.name}</h2><p>${currentUser.role} · signed in locally</p><div class="permission-row">${currentUser.permissions.map((permission) => `<span>${permission}</span>`).join('')}</div></div><div class="settings-card"><span class="eyebrow">BROWSER CAPABILITIES</span><div class="capability"><span class="cap-dot ${state.promptMode === 'prompt-api' ? 'on' : ''}"></span><div><strong>Prompt API</strong><small>${state.promptMode === 'prompt-api' ? 'Available and active' : 'Fallback mode active'}</small></div></div><div class="capability"><span class="cap-dot ${state.webMcpMode === 'webmcp' ? 'on' : ''}"></span><div><strong>WebMCP</strong><small>${state.webMcpMode === 'webmcp' ? 'Tools registered with browser' : 'Demo registry active'}</small></div></div></div></div><div class="debug-status-grid settings-runtime"><div class="debug-card"><div class="debug-card-heading"><span class="eyebrow">WEBMCP</span>${status(state.webMcpRegistration, state.webMcpRegistration === 'complete')}</div><div class="debug-big">${state.webMcpRegisteredTools.length}<em>/ ${tools.length} tools</em></div><div class="status-line"><span>Secure context</span>${status(secure ? 'yes' : 'no', secure)}</div><div class="status-line"><span>document.modelContext</span>${status(documentContext ? 'available' : 'missing', documentContext)}</div><div class="status-line"><span>navigator.modelContext</span>${status(navigatorContext ? 'available (legacy)' : 'missing', navigatorContext)}</div><div class="status-line"><span>Registration errors</span>${status(String(state.webMcpErrors.length), state.webMcpErrors.length === 0)}</div></div><div class="debug-card"><div class="debug-card-heading"><span class="eyebrow">PROMPT API</span>${status(state.promptAvailability, state.promptApiAvailable)}</div><div class="debug-big">${state.promptSessionState}<em> session</em></div><div class="status-line"><span>LanguageModel</span>${status(state.promptApiAvailable ? 'available' : 'missing', state.promptApiAvailable)}</div><div class="status-line"><span>Model download</span>${status(downloadLabel, state.promptDownload === 'available')}</div>${progressMarkup}<div class="status-line"><span>Last model path</span>${status(state.promptMode === 'prompt-api' ? 'native response' : 'not used', state.promptMode === 'prompt-api')}</div><small class="debug-help">Availability is passive. Use “Prepare local model” or send a prompt to call LanguageModel.create() and begin downloading when needed. The session includes the page tools.</small></div></div><details class="debug-section system-prompt" open><summary><span><span class="eyebrow">PROMPT API / PARAMETERS</span><strong>Show all parameters configured for the Prompt API</strong></span><span class="tool-count">${state.webMcpToolCatalog.length} LIVE TOOLS</span></summary><pre>${escapeHtml(JSON.stringify(promptApiSettings(), null, 2))}</pre></details><div class="architecture-note"><span>⌘</span><div><strong>No backend LLM. No API tokens.</strong><p>Tools run against the state this page already has. In a production browser with WebMCP enabled, the same registry is handed to the browser's model context API.</p></div></div></section>`
}

*/

function render() {
  renderView({
    state,
    appData,
    currentUser,
    project,
    toolCount: tools.length,
    toolDetailsByName,
    promptApiSettings,
  })
  bindEvents()
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((element) => element.addEventListener('click', () => { state.scene = element.dataset.scene as Scene; render() }))
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((element) => element.addEventListener('click', () => { state.filter = element.dataset.filter!; render() }))
  document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach((element) => element.addEventListener('click', () => {
    const input = document.querySelector<HTMLInputElement>('#chat-input')
    if (input) {
      input.value = element.dataset.prompt || ''
      input.focus()
    }
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-prompt-submit]').forEach((element) => element.addEventListener('click', () => {
    const prompt = element.dataset.promptSubmit
    if (prompt) void askAgent(prompt)
  }))
  document.querySelector<HTMLFormElement>('#chat-form')?.addEventListener('submit', (event) => { event.preventDefault(); const input = document.querySelector<HTMLInputElement>('#chat-input'); if (input?.value.trim()) { const value = input.value.trim(); input.value = ''; void askAgent(value) } })
  document.querySelector<HTMLButtonElement>('[data-action="restart-conversation"]')?.addEventListener('click', restartConversation)
  document.querySelector<HTMLButtonElement>('[data-action="prepare-model"]')?.addEventListener('click', () => { void ensurePromptSession().catch((error) => debugLog('error', 'Local model preparation failed', error instanceof Error ? error.message : String(error))) })
}

void registerWebMcpTools()
void detectPromptApi()
render()
