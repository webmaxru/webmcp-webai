import { describe, expect, it } from 'vitest'
import { parseAssistantResponse, validateToolInput } from '../src/tool-protocol'

describe('tool protocol', () => {
  it('rejects an unknown argument name at the strict validation boundary', () => {
    expect(validateToolInput('set_task_status', { task_id: 'search_tasks accessibility task' })).toContain('does not accept')
  })

  it('canonicalizes the legacy snake-case task id emitted by older model runs', () => {
    expect(parseAssistantResponse(JSON.stringify({
      kind: 'tool_call',
      tool: 'set_task_status',
      arguments: { task_id: 't-4', status: 'in progress' },
    }))).toEqual({ kind: 'tool_call', toolCall: { name: 'set_task_status', input: { taskId: 't-4', status: 'in progress' } } })
  })

  it('accepts the exact chained mutation shape', () => {
    expect(parseAssistantResponse(JSON.stringify({
      kind: 'tool_call',
      tool: 'set_task_status',
      arguments: { taskId: 't-1', status: 'Done' },
    }))).toEqual({ kind: 'tool_call', toolCall: { name: 'set_task_status', input: { taskId: 't-1', status: 'Done' } } })
  })
})
