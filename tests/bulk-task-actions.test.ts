import { describe, expect, it } from 'vitest'
import { applyBulkTaskStatus, getBulkTaskStatus, parseSearchMatches } from '../src/bulk-task-actions'

describe('bulk task actions', () => {
  it('extracts the requested status from an all-tasks command', () => {
    expect(getBulkTaskStatus('Set all high priority tasks status to done')).toBe('Done')
    expect(getBulkTaskStatus('Mark all tasks as in_progress')).toBe('In progress')
  })

  it('does not treat a normal search as a bulk mutation', () => {
    expect(getBulkTaskStatus('Find all high priority tasks')).toBeUndefined()
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
})
