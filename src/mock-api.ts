import appData from './data/app.json'
import workspaceData from './data/workspace.json'
import userData from './data/user.json'
import { type Project, type Task, type TaskStatus, searchTasks as filterTasks } from './task-data'

export interface CurrentUser {
  name: string
  role: string
  initials: string
  permissions: string[]
}

export interface AppData {
  dateLabel: string
  nextMilestone: string
  nextMilestoneLabel: string
  activityCount: number
}

let projectState: Project = structuredClone(workspaceData) as Project

export function getProject(): Project {
  return projectState
}

export function getCurrentUser(): CurrentUser {
  return structuredClone(userData)
}

export function getAppData(): AppData {
  return structuredClone(appData)
}

export function searchProjectTasks(query: string): Task[] {
  return filterTasks(query, projectState.tasks)
}

export function setProjectTaskStatus(taskId: string, status: TaskStatus): Task | undefined {
  const task = projectState.tasks.find((candidate) => candidate.id === taskId)
  if (!task) return undefined
  task.status = status
  return task
}
