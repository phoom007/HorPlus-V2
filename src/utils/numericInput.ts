/**
 * Utility for normalizing user-typed business numeric input values.
 * 
 * Rules:
 * - Strips unnecessary leading zeroes:
 *   "01" => "1"
 *   "014000" => "14000"
 *   "0005000" => "5000"
 *   "000" => "0"
 *   "000.50" => "0.50"
 *   "014000.25" => "14000.25"
 *   "0." => "0."
 * - Preserves empty string when field is cleared
 * - Strips non-numeric characters (allows single decimal point if allowDecimal is true)
 * - DOES NOT apply to identifiers (phone, ID card, bank account, room number "001", referral code, LINE channel ID)
 */
export function normalizeNumericInput(
  val: string | number | undefined | null,
  allowDecimal = false
): string {
  if (val === undefined || val === null) return '';
  const str = String(val).trim();
  if (str === '') return '';

  if (allowDecimal) {
    // Keep only digits and decimal point
    let cleaned = str.replace(/[^0-9.]/g, '');
    if (!cleaned) return '';

    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }

    if (cleaned.startsWith('.')) {
      cleaned = '0' + cleaned;
    }

    if (cleaned.includes('.')) {
      const [intPart, decPart] = cleaned.split('.');
      const normalizedInt = intPart.replace(/^0+(?=\d)/, '') || '0';
      return `${normalizedInt}.${decPart}`;
    }

    return cleaned.replace(/^0+(?=\d)/, '') || '0';
  } else {
    const cleaned = str.replace(/[^0-9]/g, '');
    if (!cleaned) return '';
    return cleaned.replace(/^0+(?=\d)/, '') || '0';
  }
}
