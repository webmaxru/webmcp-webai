import { describe, expect, it } from 'vitest'
import { applyBulkTaskStatus, getBulkTaskStatus, getRequestedTaskMutationFields, parseSearchMatches } from '../src/bulk-task-actions'

describe('bulk task actions', () => {
  it('distinguishes priority and status mutation requests', () => {
    expect([...getRequestedTaskMutationFields('Set customer demo priority to low')]).toEqual(['priority'])
    expect([...getRequestedTaskMutationFields('Set customer demo status to done')]).toEqual(['status'])
    expect([...getRequestedTaskMutationFields('Set customer demo status to done and priority to low')]).toEqual(['status', 'priority'])
  })

  it('extracts the requested status from an all-tasks command', () => {
    expect(getBulkTaskStatus('Set all high priority tasks status to done')).toBe('Done')
    expect(getBulkTaskStatus('Mark all tasks as in_progress')).toBe('In progress')
  })

  it('does not treat a normal search as a bulk mutation', () => {
    expect(getBulkTaskStatus('Find all high priority tasks')).toBeUndefined()
  })

  it('recognizes a follow-up mutation for the previously found tasks', () => {
    expect(getBulkTaskStatus('Set their status to done', true)).toBe('Done')
    expect(getBulkTaskStatus('Set their status to done')).toBeUndefined()
  })

  it('parses only search results containing task identifiers', () => {
    expect(parseSearchMatches(JSON.stringify({
      matches: [{ id: 't-1', title: 'First' }, { title: 'Missing id' }, 'invalid'],
    })).map((task) => task.id)).toEqual(['t-1'])
    expect(parseSearchMatches('not json')).toEqual([])
  })

  it('updates every matched task in search-result order', () => {
    const matches = parseSearchMatches(JSON.stringify({ matches: [{ id: 't-1' }, { id: 't-4' }] }))
    expect(applyBulkTaskStatus(matches, 'Done', (taskId, status) => ({ taskId, status }))).toEqual([
      { taskId: 't-1', status: 'Done' },
      { taskId: 't-4', status: 'Done' },
    ])
  })

  it('updates a duplicated search match only once', () => {
    const matches = parseSearchMatches(JSON.stringify({ matches: [{ id: 't-1' }, { id: 't-1' }] }))
    const updates: string[] = []
    applyBulkTaskStatus(matches, 'Done', (taskId) => {
      updates.push(taskId)
      return taskId
    })
    expect(updates).toEqual(['t-1'])
  })
})
