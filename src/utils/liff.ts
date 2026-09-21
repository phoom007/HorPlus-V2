/**
 * @license Apache-2.0
 * LINE LIFF (LINE Front-end Framework) Client Integration Helper
 */

import liff from '@line/liff';

export interface LiffUserProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

let liffInitialized = false;
let initPromise: Promise<boolean> | null = null;

export function getLiffId(): string {
  return (import.meta as any).env?.VITE_LINE_LIFF_ID || '2011672957-pIlWUt9e';
}

/**
 * Initialize LIFF SDK safely.
 * Returns true if initialization succeeded, false otherwise.
 */
export async function initLiff(): Promise<boolean> {
  if (liffInitialized) return true;
  if (initPromise) return initPromise;

  const liffId = getLiffId();
  if (!liffId) {
    console.warn('[LIFF] No LIFF ID configured.');
    return false;
  }

  initPromise = (async () => {
    try {
      await liff.init({ liffId });
      liffInitialized = true;
      return true;
    } catch (err: any) {
      console.warn('[LIFF] Initialization failed:', err.message);
      return false;
    }
  })();

  return initPromise;
}

/**
 * Check if the current app is running inside the LINE in-app browser.
 */
export function isInLineApp(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Line\//i.test(ua) || (liffInitialized && liff.isInClient());
}

/**
 * Retrieve the current LINE user profile if logged in via LIFF.
 */
export async function getLiffProfile(): Promise<LiffUserProfile | null> {
  try {
    const ready = await initLiff();
    if (!ready || !liff.isLoggedIn()) return null;
    const profile = await liff.getProfile();
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      statusMessage: profile.statusMessage,
    };
  } catch (err: any) {
    console.warn('[LIFF] Failed to get profile:', err.message);
    return null;
  }
}

/**
 * Safely close the LIFF window if open inside LINE client.
 */
export function closeLiffWindow(): void {
  try {
    if (liffInitialized && liff.isInClient()) {
      liff.closeWindow();
    }
  } catch {}
}
