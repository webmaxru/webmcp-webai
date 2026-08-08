export const PROMPT_API_RETRY_LIMIT = 1

export function isUnknownPromptApiError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value)
  return message.includes('kErrorUnknown')
}
