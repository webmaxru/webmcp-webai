import { normalizeTaskStatus, type Task, type TaskStatus } from './task-data'

export type TaskMutationField = 'status' | 'priority'

export function getRequestedTaskMutationFields(message: string): Set<TaskMutationField> {
  const fields = new Set<TaskMutationField>()
  if (/\bstatus(?:es)?\b/i.test(message)) fields.add('status')
  if (/\bpriorit(?:y|ies)\b/i.test(message)) fields.add('priority')
  return fields
}

export function getBulkTaskStatus(message: string, hasPriorSearchMatches = false): TaskStatus | undefined {
  const refersToPriorMatches = hasPriorSearchMatches && /\b(their|those|these|matching|found)\b/i.test(message)
  if (!/\ball\b/i.test(message) && !refersToPriorMatches) return undefined

  const statusMatch = message.match(/(?:\b(?:status|statuses)\b[\s\S]*?\bto\b|\bas\b)\s+(todo|in[\s_-]*progress|done)\b/i)
  return statusMatch ? normalizeTaskStatus(statusMatch[1]) : undefined
}

export function parseSearchMatches(result: string): Task[] {
  try {
    const parsed: unknown = JSON.parse(result)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []

    const matches = (parsed as { matches?: unknown }).matches
    if (!Array.isArray(matches)) return []

    return matches.filter((match): match is Task => (
      Boolean(match) &&
      typeof match === 'object' &&
      typeof (match as Task).id === 'string'
    ))
  } catch {
    return []
  }
}

export function applyBulkTaskStatus<T>(
  matches: Task[],
  status: TaskStatus,
  update: (taskId: string, status: TaskStatus) => T,
): T[] {
  const updatedTaskIds = new Set<string>()
  return matches.flatMap((task) => {
    if (updatedTaskIds.has(task.id)) return []
    updatedTaskIds.add(task.id)
    return [update(task.id, status)]
  })
}
