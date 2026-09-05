/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Thai Identity Utility (LOCAL-07 Batch 02)
 * Handles canonical Thai name normalization, honorific title stripping,
 * exact Thai phone normalization, deterministic Levenshtein similarity,
 * and privacy masking for Tenant self-claim discovery.
 */

/**
 * Common Thai honorific prefixes / titles to strip for comparison.
 */
export const THAI_HONORIFIC_PREFIXES = [
  'นาย',
  'นางสาว',
  'นาง',
  'น.ส.',
  'น.ส',
  'นส.',
  'นส',
  'คุณ',
  'ท่าน',
  'เด็กชาย',
  'เด็กหญิง',
  'ด.ช.',
  'ด.ช',
  'ดช.',
  'ดช',
  'ด.ญ.',
  'ด.ญ',
  'ดญ.',
  'ดญ',
  'mr.',
  'mr',
  'mrs.',
  'mrs',
  'ms.',
  'ms',
  'miss',
  'นายแพทย์',
  'พญ.',
  'พ.ญ.',
  'ดร.',
  'ดร',
  'dr.',
  'dr',
];

/**
 * Normalizes a Thai full name:
 * 1. Unicode NFC normalization
 * 2. Trim and lowercase (for English characters)
 * 3. Collapse multiple whitespace characters into single space
 * 4. Strip recognized honorific title prefixes
 */
export function normalizeFullName(rawName: string): string {
  if (!rawName) return '';
  let normalized = rawName
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  // Sort prefixes by length descending so longer prefixes (e.g. 'นางสาว', 'เด็กชาย') match before shorter ones ('นาง', 'ด.ช.')
  const sortedPrefixes = [...THAI_HONORIFIC_PREFIXES].sort((a, b) => b.length - a.length);

  for (const prefix of sortedPrefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim();
      break;
    }
  }

  return normalized;
}

/**
 * Normalizes Thai phone number:
 * 1. Strip all non-digits (spaces, dashes, parens, pluses)
 * 2. If starts with 66, convert 66 to 0 (e.g. +66831234567 -> 0831234567, 66831234567 -> 0831234567)
 * 3. Exact 9 or 10 digit string
 */
export function normalizeThaiPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  let digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length < 9 || digits.length > 10) {
    return null;
  }
  return digits;
}

/**
 * Deterministic Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculates deterministic name similarity score (0.0 to 1.0)
 * Formula: 1 - distance / max(length(s1), length(s2))
 */
export function calculateNameSimilarity(storedName: string, inputName: string): number {
  const normStored = normalizeFullName(storedName);
  const normInput = normalizeFullName(inputName);

  if (!normStored || !normInput) return 0;
  if (normStored === normInput) return 1.0;

  const distance = levenshteinDistance(normStored, normInput);
  const maxLength = Math.max(normStored.length, normInput.length);

  return 1 - distance / maxLength;
}

/**
 * Masks full name for public candidate presentation.
 * Preserves first name, masks surname:
 * e.g. "นายสมชาย ใจดี" -> "นายสมชาย ใXXX"
 * e.g. "สมชาย ใจดี" -> "สมชาย ใXXX"
 * If single name: "สมชาย" -> "สมXXX"
 */
export function maskFullName(rawName: string): string {
  if (!rawName) return '';
  const trimmed = rawName.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length >= 2) {
    const firstName = parts.slice(0, -1).join(' ');
    const lastName = parts[parts.length - 1];
    const maskedLast = lastName.length > 1 ? lastName.charAt(0) + 'XXX' : 'XXX';
    return `${firstName} ${maskedLast}`;
  }

  // Single word
  if (trimmed.length > 2) {
    return trimmed.slice(0, 2) + 'XXX';
  }
  return trimmed + 'XXX';
}

/**
 * Masks phone number for public candidate presentation.
 * e.g. "0831234567" -> "083-XXX-XXXX"
 * e.g. "083-123-4567" -> "083-XXX-XXXX"
 */
export function maskPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length >= 9) {
    const prefix = digits.slice(0, 3);
    return `${prefix}-XXX-XXXX`;
  }
  return 'XXX-XXX-XXXX';
}

/**
 * Checks if a given national ID string is a masked display value (e.g. "1-1004-XXXXX-XX-X" or contains 'x'/'X').
 */
export function isMaskedNationalId(id?: string | null): boolean {
  if (!id) return false;
  return /[xX]/.test(id);
}

/**
 * Normalizes a single full name field, preserving the complete display value while
 * intelligently deriving firstName and lastName.
 *
 * Requirements:
 * 1. Always preserves the full normalized input in `displayName` (NFC, trimmed, collapsed whitespace).
 * 2. Does NOT destructively rewrite or silently drop tokens.
 * 3. Strips honorific prefix (Thai/English) only to derive `firstName` and `lastName`.
 * 4. Handles single-token names safely (lastName = null).
 */
export function parseAndNormalizeName(rawName?: string | null): {
  displayName: string;
  firstName: string;
  lastName: string | null;
} {
  if (!rawName || rawName.trim().length === 0) {
    return { displayName: '', firstName: '', lastName: null };
  }

  // 1. Unicode NFC normalization and collapse repeated whitespace
  const normalizedDisplay = rawName
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');

  // 2. Identify and strip honorific prefix for firstName/lastName derivation
  const sortedPrefixes = [...THAI_HONORIFIC_PREFIXES].sort((a, b) => b.length - a.length);
  let remainder = normalizedDisplay;

  for (const prefix of sortedPrefixes) {
    // Case-insensitive prefix check for Latin prefixes (mr., mrs., etc.)
    if (remainder.toLowerCase().startsWith(prefix.toLowerCase())) {
      const isLatinPrefix = /^[a-zA-Z.]+$/.test(prefix);
      if (isLatinPrefix && !prefix.endsWith('.')) {
        const nextChar = remainder.slice(prefix.length, prefix.length + 1);
        if (nextChar && /[a-zA-Z]/.test(nextChar)) {
          continue; // Word boundary check: don't match "Drew" as "Dr"
        }
      }
      const sliced = remainder.slice(prefix.length).trim();
      if (sliced.length > 0) {
        remainder = sliced;
        break;
      }
    }
  }

  // 3. Tokenize remainder into firstName and lastName
  const tokens = remainder.split(' ').filter(Boolean);

  if (tokens.length === 0) {
    return {
      displayName: normalizedDisplay,
      firstName: normalizedDisplay,
      lastName: null,
    };
  }

  if (tokens.length === 1) {
    return {
      displayName: normalizedDisplay,
      firstName: tokens[0],
      lastName: null,
    };
  }

  return {
    displayName: normalizedDisplay,
    firstName: tokens[0],
    lastName: tokens.slice(1).join(' '),
  };
}

