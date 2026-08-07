export type DownloadProgress = number | null

export function mergeDownloadProgress(current: DownloadProgress, loaded?: number, total?: number): DownloadProgress {
  if (typeof loaded !== 'number' || !Number.isFinite(loaded) || typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
    return current
  }

  const next = Math.max(0, Math.min(1, loaded / total))
  return current === null ? next : Math.max(current, next)
}
