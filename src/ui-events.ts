import type { AppState, DebugLevel, Scene } from './app-types'

type UiEventOptions = {
  state: AppState
  render: () => void
  askAgent: (message: string) => Promise<void>
  restartConversation: () => void
  prepareModel: () => Promise<unknown>
  debugLog: (level: DebugLevel, message: string, detail?: string) => void
}

export function bindUiEvents({ state, render, askAgent, restartConversation, prepareModel, debugLog }: UiEventOptions) {
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((element) => element.addEventListener('click', () => { state.scene = element.dataset.scene as Scene; render() }))
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((element) => element.addEventListener('click', () => { state.filter = element.dataset.filter!; render() }))
  document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach((element) => element.addEventListener('click', () => {
    const input = document.querySelector<HTMLInputElement>('#chat-input')
    if (input) {
      input.value = element.dataset.prompt || ''
      input.focus()
    }
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-prompt-submit]').forEach((element) => element.addEventListener('click', () => {
    const prompt = element.dataset.promptSubmit
    if (prompt) void askAgent(prompt)
  }))
  document.querySelector<HTMLFormElement>('#chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = document.querySelector<HTMLInputElement>('#chat-input')
    if (input?.value.trim()) {
      const value = input.value.trim()
      input.value = ''
      void askAgent(value)
    }
  })
  document.querySelector<HTMLButtonElement>('[data-action="restart-conversation"]')?.addEventListener('click', restartConversation)
  document.querySelector<HTMLButtonElement>('[data-action="prepare-model"]')?.addEventListener('click', () => {
    void prepareModel().catch((error) => debugLog('error', 'Local model preparation failed', error instanceof Error ? error.message : String(error)))
  })
}
