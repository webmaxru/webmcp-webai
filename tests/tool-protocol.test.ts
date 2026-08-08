import { describe, expect, it } from 'vitest'
import { parseAssistantResponse, validateToolInput } from '../src/tool-protocol'

describe('tool protocol', () => {
  it('rejects a mutation that tries to pass a search tool name as an argument', () => {
    expect(validateToolInput('set_task_status', { task_id: 'search_tasks accessibility task' })).toContain('does not accept')
    expect(() => parseAssistantResponse(JSON.stringify({
      kind: 'tool_call',
      tool: 'set_task_status',
      arguments: { task_id: 'search_tasks accessibility task' },
    }))).toThrow('Tool names must only appear')
  })

  it('accepts the exact chained mutation shape', () => {
    expect(parseAssistantResponse(JSON.stringify({
      kind: 'tool_call',
      tool: 'set_task_status',
      arguments: { taskId: 't-1', status: 'Done' },
    }))).toEqual({ kind: 'tool_call', toolCall: { name: 'set_task_status', input: { taskId: 't-1', status: 'Done' } } })
  })
})
