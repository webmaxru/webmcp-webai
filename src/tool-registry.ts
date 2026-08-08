import toolDetails from './data/tools.json'
import { searchProjectTasks, setProjectTaskPriority, setProjectTaskStatus, type CurrentUser } from './mock-api'
import { normalizeTaskPriority, normalizeTaskStatus, TASK_PRIORITIES, TASK_STATUSES, type Project } from './task-data'
import { normalizeToolInput, validateToolInput } from './tool-protocol'
import type { AppState, ChatMessage, DebugLevel, LocalTool, PromptTool, ToolCall, ToolDetails } from './app-types'

type ToolRegistryOptions = {
  project: Project
  currentUser: CurrentUser
  state: AppState
  debugLog: (level: DebugLevel, message: string, detail?: string) => void
  render: () => void
}

export interface ToolRegistry {
  tools: LocalTool[]
  promptTools: PromptTool[]
  invokeTool: (name: string, input?: Record<string, string>, source?: string) => string
}

export function createToolRegistry({ project, currentUser, state, debugLog, render }: ToolRegistryOptions): ToolRegistry {
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

  const invokeTool = (name: string, input: Record<string, string> = {}, source = 'Page tool') => {
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

  const promptTools: PromptTool[] = tools.map((tool) => ({
    name: tool.details.name,
    description: tool.details.description,
    inputSchema: tool.details.inputSchema,
    execute: async (input: Record<string, string>) => {
      debugLog('info', `Prompt API requested ${tool.details.name}`, JSON.stringify(input))
      return invokeTool(tool.details.name, input, 'Prompt API tool execution')
    },
  }))

  return { tools, promptTools, invokeTool }
}

export function getToolDetailsByName() {
  return Object.fromEntries(toolDetails.map((tool) => [tool.name, tool])) as Record<string, ToolDetails>
}
