import { normalizeTaskStatus, type Task, type TaskStatus } from './task-data'

export function getBulkTaskStatus(message: string): TaskStatus | undefined {
  if (!/\ball\b/i.test(message)) return undefined

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
  return matches.map((task) => update(task.id, status))
}
