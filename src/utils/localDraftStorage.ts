/**
 * Local-First Registration Draft Storage using IndexedDB (with localStorage fallback)
 * Scoped per user ID and registration context (initial vs add_dorm)
 * 
 * Invariants:
 * - Never stores plaintext LINE Channel Secret in local draft storage
 * - Zero network requests per keystroke (local-first browser persistence)
 * - Safely restored on F5 reload / component remount
 * - Cleared upon successful registration finalization
 * @license Apache-2.0
 */

const DB_NAME = 'horplus_local_drafts_db';
const DB_VERSION = 1;
const STORE_NAME = 'registration_drafts';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in current environment'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'draftKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function sanitizeDraftForStorage(draft: any): any {
  if (!draft || typeof draft !== 'object') return draft;
  const safe = JSON.parse(JSON.stringify(draft));

  // 1. Strip sensitive credentials (LINE Channel Secret MUST NEVER be persisted locally)
  if (safe.formData?.lineOA?.channelSecret) {
    safe.formData.lineOA.channelSecret = '';
  }

  // 2. Security Invariant: Raw base64/data URLs for signatures MUST NEVER be persisted locally in IndexedDB/localStorage
  // Only safe object-storage references (e.g. object keys, https URLs, signed URLs) are permitted.
  if (safe.formData?.ownerSignatureUrl && typeof safe.formData.ownerSignatureUrl === 'string' && safe.formData.ownerSignatureUrl.startsWith('data:')) {
    safe.formData.ownerSignatureUrl = '';
  }
  if (safe.ownerSignatureUrl && typeof safe.ownerSignatureUrl === 'string' && safe.ownerSignatureUrl.startsWith('data:')) {
    safe.ownerSignatureUrl = '';
  }

  // 3. Building Code Invariant: English characters in roomPrefix/code are canonicalized to uppercase
  if (Array.isArray(safe.formData?.buildings)) {
    safe.formData.buildings.forEach((b: any) => {
      if (b && typeof b.roomPrefix === 'string') {
        b.roomPrefix = b.roomPrefix.toUpperCase();
      }
      if (b && typeof b.code === 'string') {
        b.code = b.code.toUpperCase();
      }
    });
  }

  return safe;
}

export async function saveRegistrationDraft(userId: string, mode: string, draft: any): Promise<void> {
  if (typeof window === 'undefined') return;
  const draftKey = `draft_${userId || 'anonymous'}_${mode || 'initial'}`;
  const safeDraft = sanitizeDraftForStorage(draft);
  safeDraft.draftKey = draftKey;
  safeDraft.savedAt = Date.now();

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(safeDraft);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback to localStorage
    try {
      localStorage.setItem(draftKey, JSON.stringify(safeDraft));
    } catch {
      // Ignore quota errors
    }
  }
}

export async function getRegistrationDraft(userId: string, mode: string): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  const draftKey = `draft_${userId || 'anonymous'}_${mode || 'initial'}`;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(draftKey);
    const result = await new Promise<any>((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (result) return result;
  } catch {
    // Fall back to localStorage
  }

  try {
    const fallback = localStorage.getItem(draftKey);
    return fallback ? JSON.parse(fallback) : null;
  } catch {
    return null;
  }
}

export async function clearRegistrationDraft(userId: string, mode: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const draftKey = `draft_${userId || 'anonymous'}_${mode || 'initial'}`;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(draftKey);
  } catch {
    // Ignore
  }
  try {
    localStorage.removeItem(draftKey);
  } catch {
    // Ignore
  }
}
