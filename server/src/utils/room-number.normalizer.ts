/**
 * Centralized deterministic room-number normalizer.
 *
 * Rules (Mandatory Correction 5):
 * 1. Preserve roomNumber exactly as entered for display.
 * 2. Trim leading/trailing whitespace.
 * 3. Apply Unicode NFKC normalization.
 * 4. Convert to lowercase for case-insensitive uniqueness comparison.
 * 5. Collapse multiple whitespace characters into a single space.
 * 6. Preserve meaningful punctuation (slashes, hyphens, etc.). Do NOT strip non-alphanumeric chars.
 */
export function normalizeRoomNumber(rawInput: string | null | undefined): string {
  if (rawInput === null || rawInput === undefined) {
    return '';
  }

  // Convert to string, normalize Unicode (NFKC)
  let normalized = String(rawInput).normalize('NFKC');

  // Trim leading/trailing whitespace
  normalized = normalized.trim();

  // Convert to lower case for comparison
  normalized = normalized.toLowerCase();

  // Collapse consecutive whitespace into a single space
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized;
}

/**
 * Validates that a room number is not blank or whitespace-only.
 * Returns a Thai validation error message if invalid.
 */
export function validateRoomNumberInput(rawInput: string | null | undefined): { isValid: boolean; errorMessage?: string; normalized: string } {
  const normalized = normalizeRoomNumber(rawInput);
  if (!normalized) {
    return {
      isValid: false,
      errorMessage: 'หมายเลขห้องพักต้องไม่เป็นค่าว่าง',
      normalized: '',
    };
  }

  if (normalized.length > 100) {
    return {
      isValid: false,
      errorMessage: 'หมายเลขห้องพักต้องมีความยาวไม่เกิน 100 ตัวอักษร',
      normalized,
    };
  }

  return {
    isValid: true,
    normalized,
  };
}
