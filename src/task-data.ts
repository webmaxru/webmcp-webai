export const TASK_STATUSES = ['Todo', 'In progress', 'Done'] as const
export type TaskStatus = typeof TASK_STATUSES[number]

export function normalizeTaskStatus(value: string): TaskStatus | undefined {
  const normalizedValue = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase()
  return TASK_STATUSES.find((status) => status.toLowerCase() === normalizedValue)
}

export const TASK_PRIORITIES = ['High', 'Medium', 'Low'] as const
export type TaskPriority = typeof TASK_PRIORITIES[number]

export interface Task {
  id: string
  title: string
  owner: string
  status: TaskStatus
  priority: TaskPriority
  due: string
}

export interface Project {
  name: string
  description: string
  health: 'On track' | 'At risk'
  tasks: Task[]
}

export const tasks: Task[] = [
  { id: 't-1', title: 'Finalize onboarding flow', owner: 'Maya', status: 'In progress', priority: 'High', due: 'Today' },
  { id: 't-2', title: 'Review usage analytics', owner: 'Noah', status: 'Todo', priority: 'Medium', due: 'Tomorrow' },
  { id: 't-3', title: 'Publish release notes', owner: 'Maya', status: 'Done', priority: 'Low', due: 'Aug 09' },
  { id: 't-4', title: 'Run accessibility audit', owner: 'Iris', status: 'Todo', priority: 'High', due: 'Aug 10' },
  { id: 't-5', title: 'Prepare customer demo', owner: 'Noah', status: 'In progress', priority: 'Medium', due: 'Aug 12' },
]

export const project: Project = {
  name: 'Atlas launch',
  description: 'A client-side project workspace. The page owns the data, state, and tools.',
  health: 'On track',
  tasks,
}

export function createProject(overrides: Partial<Omit<Project, 'tasks'>> & { tasks?: Task[] } = {}): Project {
  return {
    ...project,
    ...overrides,
    tasks: overrides.tasks ?? tasks,
  }
}

export function searchTasks(query: string, source: Task[] = tasks): Task[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return source

  const priorityMatch = normalizedQuery.match(/\b(high|medium|low)\s+priority\b/)
  if (priorityMatch) {
    return source.filter((task) => task.priority.toLowerCase() === priorityMatch[1])
  }

  const terms = normalizedQuery.split(/\s+/)
  return source.filter((task) => {
    const searchableText = Object.values(task).join(' ').toLowerCase()
    return terms.some((term) => searchableText.includes(term))
  })
}

export function updateTaskStatus(taskId: string, status: TaskStatus, source: Task[] = tasks): Task | undefined {
  const task = source.find((candidate) => candidate.id === taskId)
  if (!task) return undefined

  task.status = status
  return task
}
