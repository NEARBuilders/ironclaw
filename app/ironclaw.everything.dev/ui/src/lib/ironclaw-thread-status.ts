export interface ThreadStatusRecord {
  isLoading: boolean;
  hasPendingApprovals: boolean;
  hasActiveRun: boolean;
}

const statusMap = new Map<string, ThreadStatusRecord>();
const listeners = new Set<() => void>();

export function setThreadStatus(threadId: string, partial: Partial<ThreadStatusRecord>) {
  const prev = statusMap.get(threadId) ?? {
    isLoading: false,
    hasPendingApprovals: false,
    hasActiveRun: false,
  };
  const next = { ...prev, ...partial };
  statusMap.set(threadId, next);
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

export function clearThreadStatus(threadId: string) {
  statusMap.delete(threadId);
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

export function getThreadStatuses(): Map<string, ThreadStatusRecord> {
  return new Map(statusMap);
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
