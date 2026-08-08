import { describe, expect, it } from 'vitest'
import { isUnknownPromptApiError } from '../src/prompt-retry'

describe('isUnknownPromptApiError', () => {
  it('matches the browser Prompt API error code', () => {
    expect(isUnknownPromptApiError(new Error('kErrorUnknown'))).toBe(true)
    expect(isUnknownPromptApiError('The agentic tool loop failed: kErrorUnknown')).toBe(true)
  })

  it('does not retry unrelated errors', () => {
    expect(isUnknownPromptApiError(new Error('NotSupportedError'))).toBe(false)
  })
})
