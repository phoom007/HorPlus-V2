/**
 * Utility for resolving the authoritative displayed party name under the landlord signature.
 * Authority order:
 * 1. Settings -> ชื่อบัญชีธนาคาร (bankAccountName)
 * 2. if empty -> Settings -> ชื่อพร้อมเพย์ (promptPayAccountName)
 * 3. if both empty -> render blank ('' - never '-', '(-)', or 'ไม่มีข้อมูล')
 *
 * Strict boundaries:
 * - Does not fall back to logged-in user name
 * - Does not fall back to dormitory name
 * - Does not use a fake hardcoded UAT name
 * @license Apache-2.0
 */

export interface LandlordPaymentSettingsLike {
  bankAccountName?: string | null;
  promptPayAccountName?: string | null;
}

export function resolveLandlordSignerName(
  settings?: LandlordPaymentSettingsLike | null
): string {
  if (!settings) return '';

  const bankName = settings.bankAccountName?.trim();
  if (bankName) {
    return bankName;
  }

  const promptPayName = settings.promptPayAccountName?.trim();
  if (promptPayName) {
    return promptPayName;
  }

  return '';
}
