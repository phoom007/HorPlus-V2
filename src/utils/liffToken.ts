/**
 * @license Apache-2.0
 * Utility to extract and manage tenant entry tokens and LIFF destination routing.
 * Supports direct query params (?t=... / ?token=...)
 * AND LIFF state encoded params (?liff.state=%3Ft%3D...)
 * AND hash-based routes (#/?liff.state=... / #?t=...)
 * AND percent-encoded query keys (?t%3D...)
 */

export function isTokenConsumed(token: string): boolean {
  if (typeof window === 'undefined' || !token) return false;
  try {
    return window.sessionStorage?.getItem(`consumed_token_${token.trim()}`) === '1';
  } catch {
    return false;
  }
}

export function markTokenConsumed(token: string): void {
  if (typeof window === 'undefined' || !token) return;
  try {
    window.sessionStorage?.setItem(`consumed_token_${token.trim()}`, '1');
  } catch {}
}

export function isTicketConsumed(ticket: string): boolean {
  if (typeof window === 'undefined' || !ticket) return false;
  try {
    return window.sessionStorage?.getItem(`consumed_ticket_${ticket.trim()}`) === '1';
  } catch {
    return false;
  }
}

export function markTicketConsumed(ticket: string): void {
  if (typeof window === 'undefined' || !ticket) return;
  try {
    window.sessionStorage?.setItem(`consumed_ticket_${ticket.trim()}`, '1');
  } catch {}
}

/**
 * Remove liff.state, ticket, and token parameters from window.location
 * without reloading the page, preventing infinite re-triggers.
 */
export function cleanLiffStateFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    let changed = false;

    for (const key of ['liff.state', 'liff_state', 't', 'token', 'ticket']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }

    for (const [key] of Array.from(url.searchParams.entries())) {
      if (/^(?:t|token|ticket)(?:=|%3D)/i.test(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }

    let cleanHash = url.hash;
    if (cleanHash && /liff\.state/i.test(cleanHash)) {
      cleanHash = '';
      changed = true;
    }

    if (changed) {
      const searchStr = url.searchParams.toString();
      const cleanUrl = url.pathname + (searchStr ? `?${searchStr}` : '') + cleanHash;
      window.history.replaceState({}, '', cleanUrl);
    }
  } catch {}
}

export function extractTenantTokenFromUrl(options: { ignoreConsumed?: boolean } = {}): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const { ignoreConsumed = false } = options;
  const searchSources = [window.location.search, window.location.hash];

  for (const src of searchSources) {
    if (!src) continue;
    const cleanSrc = src.startsWith('?') || src.startsWith('#') ? src.slice(1) : src;
    const params = new URLSearchParams(cleanSrc.includes('?') ? cleanSrc.split('?')[1] : cleanSrc);

    // 1. Direct query parameter matching
    const directToken = params.get('t') || params.get('token');
    if (directToken && directToken.trim()) {
      const t = directToken.trim();
      if (!ignoreConsumed || !isTokenConsumed(t)) {
        return t;
      }
    }

    // 2. Encoded key matching (e.g. t%3D<token> or t=<token> stored as query key)
    for (const [key] of params.entries()) {
      if (/^t(?:=|%3D)/i.test(key)) {
        const valPart = key.replace(/^t(?:=|%3D)/i, '').trim();
        if (valPart && (!ignoreConsumed || !isTokenConsumed(valPart))) {
          return valPart;
        }
      }
      if (/^token(?:=|%3D)/i.test(key)) {
        const valPart = key.replace(/^token(?:=|%3D)/i, '').trim();
        if (valPart && (!ignoreConsumed || !isTokenConsumed(valPart))) {
          return valPart;
        }
      }
    }

    // 3. liff.state parameter decoding (handles multiple URL encodings)
    const liffState = params.get('liff.state');
    if (liffState) {
      try {
        let decoded = decodeURIComponent(liffState);
        if (decoded.includes('%')) {
          try { decoded = decodeURIComponent(decoded); } catch {}
        }
        const searchPart = decoded.includes('?') ? decoded.split('?')[1] : decoded;
        const innerParams = new URLSearchParams(searchPart);
        const innerToken = innerParams.get('t') || innerParams.get('token');
        if (innerToken && innerToken.trim()) {
          const t = innerToken.trim();
          if (!ignoreConsumed || !isTokenConsumed(t)) {
            return t;
          }
        }
        for (const [k] of innerParams.entries()) {
          if (/^t(?:=|%3D)/i.test(k)) {
            const v = k.replace(/^t(?:=|%3D)/i, '').trim();
            if (v && (!ignoreConsumed || !isTokenConsumed(v))) {
              return v;
            }
          }
          if (/^token(?:=|%3D)/i.test(k)) {
            const v = k.replace(/^token(?:=|%3D)/i, '').trim();
            if (v && (!ignoreConsumed || !isTokenConsumed(v))) {
              return v;
            }
          }
        }
      } catch {}
    }
  }

  // 4. Regex fallback against window.location.href
  try {
    const fullHref = decodeURIComponent(window.location.href);
    const match = fullHref.match(/(?:[?&#]|liff\.state=.*?)(?:t|token)(?:=|%3D)([a-f0-9]{32,64})/i);
    if (match && match[1]) {
      const t = match[1].trim();
      if (!ignoreConsumed || !isTokenConsumed(t)) {
        return t;
      }
    }
  } catch {}

  return null;
}

/**
 * Extract target deep-link destination path from liff.state parameter.
 * Handles paths like:
 * - /tenant
 * - /tenant/register
 * - /owner/home
 * - /owner/rooms
 * - /api/v1/auth/line-direct-entry?ticket=...
 * - ?t=... (normalizes to /tenant?t=...)
 */
export function extractLiffDestinationPath(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const searchSources = [window.location.search, window.location.hash];

  for (const src of searchSources) {
    if (!src) continue;
    const cleanSrc = src.startsWith('?') || src.startsWith('#') ? src.slice(1) : src;
    const params = new URLSearchParams(cleanSrc.includes('?') ? cleanSrc.split('?')[1] : cleanSrc);
    const liffState = params.get('liff.state');
    if (liffState) {
      try {
        let decoded = decodeURIComponent(liffState);
        if (decoded.includes('%')) {
          try { decoded = decodeURIComponent(decoded); } catch {}
        }
        decoded = decoded.trim();
        if (decoded.startsWith('/')) {
          return decoded;
        }
        if (decoded.startsWith('?')) {
          return `/tenant${decoded}`;
        }
      } catch {}
    }
  }

  return null;
}
