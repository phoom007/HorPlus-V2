/**
 * Canonical helper to resolve LINE OA friend-add URL from effective public LINE ID.
 * Example: '@my_dorm' -> 'https://line.me/R/ti/p/%40my_dorm'
 * @license Apache-2.0
 */
export function resolveLineFriendAddUrl(lineId?: string | null): string {
  if (!lineId) return '';
  const cleanId = lineId.replace(/^@/, '').trim();
  if (!cleanId) return '';
  return `https://line.me/R/ti/p/%40${encodeURIComponent(cleanId)}`;
}

