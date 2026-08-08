import { mergeDownloadProgress } from './prompt-download'
import { isUnknownPromptApiError, PROMPT_API_RETRY_LIMIT } from './prompt-retry'
import { applyBulkTaskStatus, getBulkTaskStatus, getRequestedTaskMutationFields, hasSuccessfulTaskMutation, parseSearchMatches } from './bulk-task-actions'
import { assistantResponseConstraint, parseAssistantResponse } from './tool-protocol'
import type { AppState, DebugLevel, PromptApiRequest, PromptLanguageModel, PromptSession } from './app-types'
import type { ToolRegistry } from './tool-registry'

type PromptApiServiceOptions = {
  state: AppState
  registry: ToolRegistry
  buildSystemPrompt: () => string
  registerWebMcpTools: () => Promise<void>
  debugLog: (level: DebugLevel, message: string, detail?: string) => void
  render: () => void
}

export interface PromptApiService {
  detect: () => Promise<void>
  ensureSession: () => Promise<PromptSession>
  ask: (message: string) => Promise<void>
  restart: () => void
  promptApiSettings: () => unknown
}

export function createPromptApiService({ state, registry, buildSystemPrompt, registerWebMcpTools, debugLog, render }: PromptApiServiceOptions): PromptApiService {
  let recentSearchMatches: ReturnType<typeof parseSearchMatches> = []
  let chatRequestTimer: ReturnType<typeof setTimeout> | null = null

  function promptSessionOptions() {
    const registeredNames = new Set(state.webMcpToolCatalog.map((tool) => tool.name))
    return {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      tools: registry.promptTools.filter((tool) => registeredNames.has(tool.name)),
    }
  }

  function promptToolRequestDefinitions() {
    const registeredNames = new Set(state.webMcpToolCatalog.map((tool) => tool.name))
    return registry.promptTools
      .filter((tool) => registeredNames.has(tool.name))
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema, execute: '[function]' }))
  }

  function promptApiSettings() {
    return {
      availability: promptSessionOptions(),
      create: {
        ...promptSessionOptions(),
        tools: promptToolRequestDefinitions(),
        initialPrompts: [{ role: 'system', content: buildSystemPrompt() }],
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

  function recordPromptFailure(entry: PromptApiRequest, error: unknown) {
    recordPromptResponse(entry, `Error: ${error instanceof Error ? error.message : String(error)}`)
  }

  async function promptAndRecord(session: PromptSession, input: string, options: { responseConstraint?: object }) {
    const entry = recordPromptRequest('prompt', { input, options })
    try {
      const response = await session.prompt(input, options)
      if (isUnknownPromptApiError(response)) throw new Error(response)
      recordPromptResponse(entry, response)
      return response
    } catch (error) {
      recordPromptFailure(entry, error)
      throw error
    }
  }

  async function detect() {
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

  async function ensureSession() {
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
      initialPrompts: [{ role: 'system', content: buildSystemPrompt() }],
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
    const createRequest = recordPromptRequest('create', promptApiSettings().create as Record<string, unknown>)
    state.promptSessionPromise = languageModel.create(createOptions).then((session) => {
      state.promptSessionRef = session
      state.promptSessionState = 'ready'
      state.promptDownload = 'available'
      recordPromptResponse(createRequest, 'Prompt session created successfully.')
      debugLog('success', 'Prompt API local model session ready', 'The next prompt will run through the native tool-enabled session.')
      render()
      return session
    }).catch((error) => {
      recordPromptFailure(createRequest, error)
      state.promptSessionState = 'error'
      state.promptSessionPromise = null
      debugLog('error', 'Prompt API session creation failed', error instanceof Error ? error.message : String(error))
      render()
      throw error
    })
    return state.promptSessionPromise
  }

  async function runAgenticLoop(session: PromptSession, message: string) {
    const promptOptions = { responseConstraint: assistantResponseConstraint }
    let response = await promptAndRecord(session, message, promptOptions)
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
        response = await promptAndRecord(session, followUp, promptOptions)
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
      if (!requestedMutationField && calledMutationField) {
        result = JSON.stringify({
          error: 'This is a read-only request. Do not call a mutation tool; use the read-only lookup result to answer the user.',
          retry: 'Call search_tasks if task lookup is needed, then return a final response without changing any task.',
        })
        debugLog('error', 'Blocked mutation during read-only request', `Requested ${toolCall.name} without explicit mutation intent.`)
      } else if (requestedMutationField && calledMutationField && requestedMutationField !== calledMutationField) {
        result = JSON.stringify({
          error: `This request changes only ${requestedMutationField}. Do not call set_task_${calledMutationField}; call set_task_${requestedMutationField} instead.`,
          retry: `Use set_task_${requestedMutationField} with the exact taskId and requested ${requestedMutationField}.`,
        })
        debugLog('error', 'Blocked mutation for the wrong task field', `Requested ${requestedMutationField}, received ${calledMutationField}.`)
      } else {
        const bulkStatus = getBulkTaskStatus(message, recentSearchMatches.length > 0)
        if (toolCall.name === 'set_task_status' && bulkStatus && recentSearchMatches.length > 0 && bulkUpdates.size === 0) {
          const updates = applyBulkTaskStatus(recentSearchMatches, bulkStatus, (taskId, status) => JSON.parse(registry.invokeTool(
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
          result = registry.invokeTool(toolCall.name, toolCall.input, 'Prompt API agentic loop')
        }
        if (toolCall.name === 'search_tasks' && bulkStatus) {
          const matches = parseSearchMatches(result)
          recentSearchMatches = []
          const updates = applyBulkTaskStatus(matches, bulkStatus, (taskId, status) => JSON.parse(registry.invokeTool(
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
      debugLog('success', 'Tool result returned to model', `${toolCall.name}: ${result}`)
      const followUp = `The page tool "${toolCall.name}" returned this result:
${result}

Use this result to answer the user's original request. For an "all" status request, the result includes an update for every matched task; do not repeat those updates. Otherwise, if another registered tool is required, return a tool_call JSON object; if the request is fully resolved, return a final JSON object.`
      response = await promptAndRecord(session, followUp, promptOptions)
    }

    throw new Error('The agentic tool loop exceeded its eight-step limit.')
  }

  async function ask(message: string) {
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
        const session = await ensureSession()
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

  function restart() {
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

  return { detect, ensureSession, ask, restart, promptApiSettings }
}
