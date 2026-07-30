import type { QueuedMutation } from "@/lib/offline-queue";

/**
 * Persistence for the trackside outbox.
 *
 * IndexedDB rather than localStorage: a marshal's phone will be backgrounded,
 * locked and reloaded between the report and the moment signal returns, and
 * localStorage is both synchronous and small enough to be evicted first. The
 * whole point is that the queue survives a page nobody kept open.
 *
 * Every function degrades to a no-op when IndexedDB is unavailable (server
 * render, private mode on some browsers) rather than throwing — a marshal
 * losing the outbox is bad, but a page that will not render at all is worse.
 */

const DB_NAME = "raceops-outbox";
const DB_VERSION = 1;
const STORE = "mutations";

function supported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase | null> {
  if (!supported()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Everything still waiting to be sent. */
export async function loadQueue(): Promise<QueuedMutation[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const request = db
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result as QueuedMutation[]);
    request.onerror = () => resolve([]);
    // The queue is small — one meeting's worth of reports — so replacing it
    // wholesale is simpler and less error-prone than diffing.
  });
}

/** Replaces the stored queue with the given items. */
export async function saveQueue(queue: QueuedMutation[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.clear();
    for (const item of queue) store.put(item);
    transaction.oncomplete = () => resolve();
    // A failed write must not reject: the in-memory queue is still correct
    // for this session, and throwing here would break the caller's flow.
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

/** Empties the outbox. Used when a person discards parked items. */
export async function clearQueue(): Promise<void> {
  await saveQueue([]);
}
