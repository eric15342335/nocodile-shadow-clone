export type AppStateChangeKind = "dataset" | "model" | "reset";

export interface AppStateChange {
  id: string;
  source: string;
  kind: AppStateChangeKind;
  at: number;
}

const TAB_ID = crypto.randomUUID();
const CHANNEL_NAME = "nocodile-browser-ml-sync";
const STORAGE_KEY = "__nocodile_browser_ml_sync__";

function makeChange(kind: AppStateChangeKind): AppStateChange {
  return { id: crypto.randomUUID(), source: TAB_ID, kind, at: Date.now() };
}

function isChange(value: unknown): value is AppStateChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Partial<AppStateChange>;
  return (
    typeof change.id === "string" &&
    typeof change.source === "string" &&
    (change.kind === "dataset" || change.kind === "model" || change.kind === "reset") &&
    typeof change.at === "number"
  );
}

export function announceAppStateChange(kind: AppStateChangeKind): void {
  if (typeof window === "undefined") return;
  const change = makeChange(kind);
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(change);
    channel.close();
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(change));
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Revision checks still protect writes when cross-tab notification is unavailable.
  }
}

export function subscribeAppStateChanges(listener: (change: AppStateChange) => void): () => void {
  if (typeof window === "undefined") return () => {};

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => {
      if (isChange(event.data) && event.data.source !== TAB_ID) listener(event.data);
    });
    return () => channel.close();
  }

  const storageListener = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const change: unknown = JSON.parse(event.newValue);
      if (isChange(change) && change.source !== TAB_ID) listener(change);
    } catch {
      // Ignore malformed unrelated storage events.
    }
  };
  window.addEventListener("storage", storageListener);
  return () => window.removeEventListener("storage", storageListener);
}
