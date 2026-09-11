export interface BrowserStorageInfo {
  persisted: boolean;
  usage: number;
  quota: number;
}

/** Ask the browser to protect the local library from best-effort eviction. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getBrowserStorageInfo(): Promise<BrowserStorageInfo> {
  try {
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    return {
      persisted,
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return { persisted: false, usage: 0, quota: 0 };
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
