import type { AppState, DebugLevel, LocalTool, WebMcpContext } from './app-types'

type WebMcpServiceOptions = {
  state: AppState
  tools: LocalTool[]
  invokeTool: (name: string, input?: Record<string, string>, source?: string) => string
  debugLog: (level: DebugLevel, message: string, detail?: string) => void
  render: () => void
  onToolsRegistered: () => void
}

export interface WebMcpService {
  register: () => Promise<void>
}

export function createWebMcpService({ state, tools, invokeTool, debugLog, render, onToolsRegistered }: WebMcpServiceOptions): WebMcpService {
  let readyPromise: Promise<void> | null = null

  const register = () => {
    if (state.webMcpRegistrationStarted) return readyPromise ?? Promise.resolve()
    state.webMcpRegistrationStarted = true
    readyPromise = (async () => {
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
        onToolsRegistered()
        render()
      }
    })()
    return readyPromise
  }

  return { register }
}
