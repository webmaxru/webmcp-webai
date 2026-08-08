import { describe, expect, it } from 'vitest'
import { createProject, project, searchTasks, tasks, updateTaskStatus } from '../src/task-data'

describe('task data', () => {
  it('keeps the project and shared task collection in sync', () => {
    expect(project.tasks).toBe(tasks)
    expect(tasks.map((task) => task.priority)).toEqual(['High', 'Medium', 'Low', 'High', 'Medium'])
  })

  it('supports configurable projects and task searches', () => {
    const customTasks = [{ ...tasks[0], id: 'custom', title: 'Custom task' }]
    const customProject = createProject({ name: 'Custom project', tasks: customTasks })

    expect(customProject.name).toBe('Custom project')
    expect(searchTasks('CUSTOM', customProject.tasks)).toEqual(customTasks)
  })

  it('maps natural-language priority searches to the shared priority field', () => {
    expect(searchTasks('high priority').map((task) => task.id)).toEqual(['t-1', 't-4'])
  })

  it('matches a task when any query word appears in its fields', () => {
    expect(searchTasks('Maya audit').map((task) => task.id)).toEqual(['t-1', 't-3', 't-4'])
  })

  it('updates a task in the selected collection', () => {
    const source = [{ ...tasks[0] }]

    expect(updateTaskStatus(source[0].id, 'Done', source)).toBe(source[0])
    expect(source[0].status).toBe('Done')
  })
})
