import workspaceData from './data/workspace.json'

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

export const tasks: Task[] = structuredClone(workspaceData.tasks) as Task[]

export const project: Project = {
  name: workspaceData.name,
  description: workspaceData.description,
  health: workspaceData.health as Project['health'],
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
