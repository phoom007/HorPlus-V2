/**
 * Bank Code Normalization and Standard Thai Bank Registry Adapter
 * Ensures bidirectional interoperability across REST DTOs, Database short codes,
 * and Thai user-facing Select dropdown components.
 * @license Apache-2.0
 */

export interface BankInfo {
  code: string;
  label: string;
  shortName: string;
  aliases?: string[];
}

export const SUPPORTED_BANKS: BankInfo[] = [
  { code: 'SCB', label: 'ไทยพาณิชย์ (SCB)', shortName: 'ไทยพาณิชย์', aliases: ['scb', 'siam commercial'] },
  { code: 'KBANK', label: 'กสิกรไทย (KBank)', shortName: 'กสิกรไทย', aliases: ['kbank', 'kasikorn', 'kasikornbank'] },
  { code: 'BBL', label: 'กรุงเทพ (BBL)', shortName: 'กรุงเทพ', aliases: ['bbl', 'bangkok bank'] },
  { code: 'KTB', label: 'กรุงไทย (KTB)', shortName: 'กรุงไทย', aliases: ['ktb', 'krungthai'] },
  { code: 'TTB', label: 'ทหารไทยธนชาต (ttb)', shortName: 'ทหารไทยธนชาต', aliases: ['ttb', 'tmb', 'thanachart', 'tmbthanachart'] },
  { code: 'BAY', label: 'กรุงศรีอยุธยา (BAY)', shortName: 'กรุงศรีอยุธยา', aliases: ['bay', 'krungsri'] },
  { code: 'GSB', label: 'ออมสิน (GSB)', shortName: 'ออมสิน', aliases: ['gsb', 'government savings bank'] },
  { code: 'KKP', label: 'เกียรตินาคินภัทร (KKP)', shortName: 'เกียรตินาคินภัทร', aliases: ['kkp', 'kiatnakin'] },
  { code: 'TISCO', label: 'ทิสโก้ (TISCO)', shortName: 'ทิสโก้', aliases: ['tisco'] },
  { code: 'CIMB', label: 'ซีไอเอ็มบี ไทย (CIMB)', shortName: 'ซีไอเอ็มบี ไทย', aliases: ['cimb', 'cimb thai'] },
  { code: 'UOB', label: 'ยูโอบี (UOB)', shortName: 'ยูโอบี', aliases: ['uob'] },
  { code: 'BAAC', label: 'ธ.ก.ส. (BAAC)', shortName: 'ธ.ก.ส.', aliases: ['baac'] },
  { code: 'GHB', label: 'ธอส. (GHB)', shortName: 'ธอส.', aliases: ['ghb', 'gh bank'] },
];

/**
 * Normalizes any bank representation (short code, Thai name with parenthesis, lowercase, etc.)
 * into a canonical uppercase bank short code (e.g. 'SCB', 'KBANK').
 * Returns empty string if invalid or unselected.
 */
export function normalizeBankCode(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-- เลือกธนาคาร --') return '';

  const upper = trimmed.toUpperCase();

  // 1. Direct match with standard bank code (e.g. 'SCB', 'kbank')
  const directMatch = SUPPORTED_BANKS.find(b => b.code === upper);
  if (directMatch) return directMatch.code;

  // 2. Check if the string matches bank label exactly (e.g. 'ไทยพาณิชย์ (SCB)')
  const labelMatch = SUPPORTED_BANKS.find(b => b.label.toLowerCase() === trimmed.toLowerCase());
  if (labelMatch) return labelMatch.code;

  // 3. Extract code from parenthesis if present, e.g. "ไทยพาณิชย์ (SCB)" -> "SCB"
  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const extracted = parenMatch[1].trim().toUpperCase();
    const found = SUPPORTED_BANKS.find(b => b.code === extracted);
    if (found) return found.code;
  }

  // 4. Match against shortName or aliases
  const matchedBank = SUPPORTED_BANKS.find(b =>
    trimmed.includes(b.shortName) ||
    b.aliases?.some(alias => trimmed.toLowerCase().includes(alias.toLowerCase()))
  );
  if (matchedBank) return matchedBank.code;

  return '';
}

/**
 * Returns the standardized Thai display label (e.g. 'ไทยพาณิชย์ (SCB)')
 * for a canonical bank code or raw input.
 */
export function getBankDisplayName(codeOrRaw: string | null | undefined): string {
  const normalized = normalizeBankCode(codeOrRaw);
  if (!normalized) return '';
  const bank = SUPPORTED_BANKS.find(b => b.code === normalized);
  return bank ? bank.label : normalized;
}
