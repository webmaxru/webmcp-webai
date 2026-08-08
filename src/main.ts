import './style.css'
import assistantSystemPromptTemplate from './assistant-system-prompt.md?raw'
import { getAppData, getCurrentUser, getProject } from './mock-api'
import { createAppState, type AppState, type DebugLevel } from './app-types'
import { render as renderView } from './render'
import { createPromptApiService } from './prompt-api-service'
import { createToolRegistry, getToolDetailsByName } from './tool-registry'
import { bindUiEvents } from './ui-events'
import { createWebMcpService } from './webmcp-service'
import type { PromptApiService } from './prompt-api-service'

const appData = getAppData()
const currentUser = getCurrentUser()
const project = getProject()
const state: AppState = createAppState()
const toolDetailsByName = getToolDetailsByName()

function debugLog(level: DebugLevel, message: string, detail?: string) {
  state.debugLogs.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), level, message, detail })
}

let render: () => void
const registry = createToolRegistry({ project, currentUser, state, debugLog, render: () => render() })
let promptApi: PromptApiService
const webMcp = createWebMcpService({ state, tools: registry.tools, invokeTool: registry.invokeTool, debugLog, render: () => render(), onToolsRegistered: () => { void promptApi.detect() } })
promptApi = createPromptApiService({
  state,
  registry,
  buildSystemPrompt: () => assistantSystemPromptTemplate.replace('{{PROJECT_NAME}}', project.name),
  registerWebMcpTools: webMcp.register,
  debugLog,
  render: () => render(),
})

render = () => {
  renderView({
    state,
    appData,
    currentUser,
    project,
    toolCount: registry.tools.length,
    toolDetailsByName,
    promptApiSettings: promptApi.promptApiSettings,
    systemPrompt: assistantSystemPromptTemplate.replace('{{PROJECT_NAME}}', project.name),
  })
  bindUiEvents({
    state,
    render,
    askAgent: promptApi.ask,
    restartConversation: promptApi.restart,
    prepareModel: promptApi.ensureSession,
    debugLog,
  })
}

void webMcp.register()
void promptApi.detect()
render()
