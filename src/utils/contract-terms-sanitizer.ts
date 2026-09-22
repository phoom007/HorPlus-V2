/**
 * Sanitizes contract terms by stripping clauses 1-5 (which are already rendered
 * in the contract summary section) so that only dorm rules / house regulations are shown.
 *
 * @param rawTerms The raw terms text from Contract.terms, TenantRegistrationRequest.terms, etc.
 * @param fallback Optional fallback string if sanitized terms are empty.
 * @returns The sanitized terms containing only dorm house rules.
 */
export function sanitizeContractTerms(
  rawTerms?: string | null,
  fallback: string = ''
): string {
  if (!rawTerms || typeof rawTerms !== 'string') {
    return fallback;
  }

  const trimmed = rawTerms.trim();
  if (!trimmed) {
    return fallback;
  }

  // Case 1: Contains 'ข้อ 1. ทรัพย์สินที่เช่า' and 'ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย'
  const clause6Regex = /ข้อ\s*6[\.:]?\s*ข้อตกลงและระเบียบการอยู่อาศัย[:\s]*/;
  if (/ข้อ\s*1[\.:]?\s*ทรัพย์สินที่เช่า/.test(trimmed) && clause6Regex.test(trimmed)) {
    const parts = trimmed.split(clause6Regex);
    if (parts.length > 1) {
      const remaining = parts.slice(1).join('').trim();
      return remaining || fallback;
    }
  }

  // Case 2: Starts with or contains 'ข้อ 1. ทรัพย์สินที่เช่า' but no 'ข้อ 6.'
  if (/ข้อ\s*1[\.:]?\s*ทรัพย์สินที่เช่า/.test(trimmed)) {
    const stripped = trimmed
      .replace(
        /(?:^|\n)\s*ข้อ\s*1[\.:]?\s*ทรัพย์สินที่เช่า[\s\S]*?(?:(?:^|\n)\s*ข้อ\s*5[\.:]?[^\n]*(?:\r?\n|$)?)/,
        ''
      )
      .trim();

    return stripped || fallback;
  }

  // Case 3: Normal dormitory rules without clauses 1-5
  return trimmed;
}
