import { describe, expect, it } from 'vitest'
import { mergeDownloadProgress } from '../src/prompt-download'

describe('mergeDownloadProgress', () => {
  it('accepts valid progress', () => {
    expect(mergeDownloadProgress(null, 50, 100)).toBe(0.5)
  })

  it('does not regress an already visible progress bar', () => {
    expect(mergeDownloadProgress(0.5, 0, 100)).toBe(0.5)
  })

  it('clamps progress to the valid range', () => {
    expect(mergeDownloadProgress(null, 150, 100)).toBe(1)
    expect(mergeDownloadProgress(null, -1, 100)).toBe(0)
  })

  it('keeps the current value when browser progress is unavailable', () => {
    expect(mergeDownloadProgress(0.5, undefined, undefined)).toBe(0.5)
    expect(mergeDownloadProgress(null, 1, 0)).toBeNull()
  })
})
