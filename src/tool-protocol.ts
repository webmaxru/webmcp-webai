export type ToolName = 'get_project_summary' | 'search_tasks' | 'get_current_user' | 'set_task_status' | 'set_task_priority'

export type ParsedAssistantResponse =
  | { kind: 'final'; answer: string }
  | { kind: 'tool_call'; toolCall: { name: ToolName; input: Record<string, string> } }

export const assistantResponseConstraint = {
  type: 'object',
  oneOf: [
    {
      properties: {
        kind: { const: 'final' },
        answer: { type: 'string' },
      },
      required: ['kind', 'answer'],
      additionalProperties: false,
    },
    {
      properties: {
        kind: { const: 'tool_call' },
        tool: { const: 'get_project_summary' },
        arguments: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
      required: ['kind', 'tool', 'arguments'],
      additionalProperties: false,
    },
    {
      properties: {
        kind: { const: 'tool_call' },
        tool: { const: 'search_tasks' },
        arguments: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
      required: ['kind', 'tool', 'arguments'],
      additionalProperties: false,
    },
    {
      properties: {
        kind: { const: 'tool_call' },
        tool: { const: 'get_current_user' },
        arguments: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
      required: ['kind', 'tool', 'arguments'],
      additionalProperties: false,
    },
    {
      properties: {
        kind: { const: 'tool_call' },
        tool: { const: 'set_task_status' },
        arguments: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['taskId', 'status'],
          additionalProperties: false,
        },
      },
      required: ['kind', 'tool', 'arguments'],
      additionalProperties: false,
    },
    {
      properties: {
        kind: { const: 'tool_call' },
        tool: { const: 'set_task_priority' },
        arguments: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            priority: { type: 'string' },
          },
          required: ['taskId', 'priority'],
          additionalProperties: false,
        },
      },
      required: ['kind', 'tool', 'arguments'],
      additionalProperties: false,
    },
  ],
} as const

const toolArgumentKeys: Record<ToolName, readonly string[]> = {
  get_project_summary: [],
  search_tasks: ['query'],
  get_current_user: [],
  set_task_status: ['taskId', 'status'],
  set_task_priority: ['taskId', 'priority'],
}

export function normalizeToolInput(name: string, input: Record<string, string>): Record<string, string>
export function normalizeToolInput(name: string, input: unknown): unknown
export function normalizeToolInput(name: string, input: unknown): unknown {
  if (!['set_task_status', 'set_task_priority'].includes(name) || !input || typeof input !== 'object' || Array.isArray(input)) return input

  const value = input as Record<string, unknown>
  if (!Object.hasOwn(value, 'task_id') || Object.hasOwn(value, 'taskId')) return input

  const { task_id, ...rest } = value
  return { ...rest, taskId: task_id }
}

export function validateToolInput(name: string, input: unknown): string | undefined {
  if (!isToolName(name)) return `Unknown tool "${name}".`
  if (!input || typeof input !== 'object' || Array.isArray(input)) return `Tool "${name}" requires an object of arguments.`

  const value = input as Record<string, unknown>
  const expectedKeys = toolArgumentKeys[name]
  const unexpectedKey = Object.keys(value).find((key) => !expectedKeys.includes(key))
  if (unexpectedKey) return `Tool "${name}" does not accept "${unexpectedKey}". Use the exact argument names from its schema.`
  const missingKey = expectedKeys.find((key) => typeof value[key] !== 'string' || value[key].length === 0)
  if (missingKey) return `Tool "${name}" requires a non-empty string argument named "${missingKey}".`
  return undefined
}

export function parseAssistantResponse(response: string): ParsedAssistantResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(response)
  } catch {
    throw new Error('The local model returned invalid JSON instead of the constrained response format.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The local model returned an invalid response object.')

  const value = parsed as Record<string, unknown>
  if (value.kind === 'final' && typeof value.answer === 'string' && Object.keys(value).every((key) => key === 'kind' || key === 'answer')) {
    return { kind: 'final', answer: value.answer }
  }
  if (value.kind !== 'tool_call' || typeof value.tool !== 'string' || !isToolName(value.tool)) {
    throw new Error('The local model returned an unknown or invalid tool call.')
  }
  const normalizedArguments = normalizeToolInput(value.tool, value.arguments)
  if (validateToolInput(value.tool, normalizedArguments) !== undefined) {
    throw new Error(`The local model returned invalid arguments for "${value.tool}". Tool names must only appear in the tool field, never as argument values.`)
  }
  return { kind: 'tool_call', toolCall: { name: value.tool, input: normalizedArguments as Record<string, string> } }
}

function isToolName(value: string): value is ToolName {
  return value === 'get_project_summary' || value === 'search_tasks' || value === 'get_current_user' || value === 'set_task_status' || value === 'set_task_priority'
}
