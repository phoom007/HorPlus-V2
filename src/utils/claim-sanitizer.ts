/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * claim-sanitizer utility
 *
 * Sanitizes initial claim input string for tenant self-claim modal and workflows.
 * Prevents placeholder names, unfinished LINE display names, and unregistered labels
 * from auto-filling into the input field.
 */

export function sanitizeClaimInput(input?: string | null): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  // 1. Dash-only or placeholder dash patterns like "-", "--"
  if (/^[-]+$/.test(trimmed)) {
    return '';
  }

  // 2. Exact or matching "ยังไม่ได้ลงทะเบียน"
  if (trimmed === 'ยังไม่ได้ลงทะเบียน' || trimmed.includes('ยังไม่ได้ลงทะเบียน')) {
    return '';
  }

  // 3. Names ending with " -" or "-" (e.g., "Phoom -", "Somchai -")
  // Typically generated when LINE profile displayName is stored as first name with "-" as last name
  if (trimmed.endsWith(' -') || trimmed.endsWith('-')) {
    return '';
  }

  return trimmed;
}
