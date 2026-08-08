import type toolDetails from './data/tools.json'

export type Scene = 'overview' | 'activity' | 'settings' | 'debug'
export type DebugLevel = 'info' | 'success' | 'error' | 'pending'
export type ToolDetails = (typeof toolDetails)[number]

export interface ToolCall {
  id: number
  name: string
  description: string
  source: string
  input: string
  output: string
  status: 'complete' | 'running'
  startedAt: number
  completedAt?: number
  durationMs?: number
}

export interface LocalTool {
  details: ToolDetails
  run: (input: Record<string, string>) => string
}

export interface WebMcpContext {
  registerTool: (tool: {
    name: string
    title: string
    description: string
    inputSchema: Record<string, unknown>
    annotations: { readOnlyHint: boolean }
    execute: (input: Record<string, string>) => Promise<unknown>
  }, options?: { signal?: AbortSignal }) => void | Promise<void>
  unregisterTool?: (name: string) => void
  getTools?: () => WebMcpTool[] | Promise<WebMcpTool[]>
}

export interface WebMcpTool {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
}

export interface PromptLanguageModel {
  availability?: (options?: Record<string, unknown>) => Promise<string> | string
  create: (options: Record<string, unknown>) => Promise<PromptSession>
}

export interface PromptSession {
  prompt: (input: string, options?: { responseConstraint?: object }) => Promise<string>
  destroy?: () => void
}

export interface PromptApiRequest {
  operation: 'create' | 'prompt'
  startedAt: number
  request: Record<string, unknown>
  response: string | null
}

export type ChatMessage = { role: 'user' | 'assistant' | 'status'; text: string }

export interface AppState {
  scene: Scene
  filter: string
  toolCalls: ToolCall[]
  callId: number
  chat: ChatMessage[]
  chatRequestPending: boolean
  promptMode: 'prompt-api' | 'mock'
  webMcpMode: 'webmcp' | 'mock'
  webMcpRegistrationStarted: boolean
  webMcpRegistration: 'pending' | 'complete' | 'unavailable' | 'error'
  webMcpRegisteredTools: string[]
  webMcpToolCatalog: WebMcpTool[]
  webMcpErrors: string[]
  promptApiAvailable: boolean
  promptAvailability: string
  promptDownload: string
  promptSessionState: 'idle' | 'creating' | 'ready' | 'error'
  promptSessionRef: PromptSession | null
  promptSessionPromise: Promise<PromptSession> | null
  promptDownloadProgress: number | null
  promptRequests: PromptApiRequest[]
  debugLogs: { time: string; level: DebugLevel; message: string; detail?: string }[]
}

export function createAppState(): AppState {
  return {
    scene: 'overview',
    filter: 'All',
    toolCalls: [],
    callId: 0,
    chat: [],
    chatRequestPending: false,
    promptMode: 'mock',
    webMcpMode: 'mock',
    webMcpRegistrationStarted: false,
    webMcpRegistration: 'pending',
    webMcpRegisteredTools: [],
    webMcpToolCatalog: [],
    webMcpErrors: [],
    promptApiAvailable: false,
    promptAvailability: 'checking',
    promptDownload: 'unknown',
    promptSessionState: 'idle',
    promptSessionRef: null,
    promptSessionPromise: null,
    promptDownloadProgress: null,
    promptRequests: [],
    debugLogs: [],
  }
}
