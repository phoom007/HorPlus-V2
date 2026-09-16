/**
 * Canonical Preset Dormitory Rules & Formatting Helpers
 * Shared between Onboarding Registration (Step 5) and Owner Settings.
 * Ensures 100% text parity and strictly sequential numbering (1., 2., 3.).
 * @license Apache-2.0
 */

export interface PresetDormRule {
  id: string;
  label: string;
  cleanText: string;
}

export const CANONICAL_PRESET_DORM_RULES: PresetDormRule[] = [
  {
    id: 'quiet_hours',
    label: '🤫 งดส่งเสียงดังหลัง 22:00',
    cleanText: 'ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.',
  },
  {
    id: 'no_smoking',
    label: '🚭 ห้ามสูบบุหรี่ในห้องพัก',
    cleanText: 'ห้ามสูบบุหรี่ บุหรี่ไฟฟ้า และสิ่งเสพติดภายในห้องพักและทางเดินโดยเด็ดขาด',
  },
  {
    id: 'no_pets_strict',
    label: '🐾 ห้ามเลี้ยงสัตว์เลี้ยง',
    cleanText: 'ห้ามนำสัตว์เลี้ยงทุกชนิดเข้ามาเลี้ยงภายในห้องพักและพื้นที่ส่วนกลาง',
  },
  {
    id: 'trash_disposal',
    label: '🗑️ มัดถุงขยะทิ้งจุดกำหนด',
    cleanText: 'กรุณามัดถุงขยะให้เรียบร้อยและนำไปทิ้ง ณ จุดทิ้งขยะของหอพักเท่านั้น',
  },
  {
    id: 'parking_rule',
    label: '🚗 จอดรถในซองที่กำหนด',
    cleanText: 'จอดรถยนต์และจักรยานยนต์ในซองจอดที่กำหนด พร้อมติดสติ๊กเกอร์หอพัก',
  },
  {
    id: 'electric_appliance',
    label: '⚡ ห้ามดัดแปลงระบบไฟฟ้า',
    cleanText: 'ห้ามดัดแปลงระบบไฟฟ้าหรือใช้เครื่องใช้ไฟฟ้าที่กินกำลังไฟสูงเกินมาตรฐาน',
  },
  {
    id: 'keycard_return',
    label: '🗝️ คืนกุญแจเมื่อย้ายออก',
    cleanText: 'เมื่อสิ้นสุดสัญญาต้องคืนคีย์การ์ดและกุญแจห้องครบตามจำนวน (หากสูญหายปรับ 500 บ.)',
  },
  {
    id: 'visitor_policy',
    label: '👥 ห้ามคนนอกค้างคืนโดยไม่แจ้ง',
    cleanText: 'ห้ามบุคคลภายนอกเข้าพักค้างคืนเกิน 2 คืนโดยไม่ได้รับอนุมัติจากเจ้าของหอพัก',
  },
  {
    id: 'cleanliness',
    label: '🧹 รักษาความสะอาดห้องพัก',
    cleanText: 'ผู้เช่าต้องดูแลรักษาความสะอาดภายในห้องพัก ไม่ปล่อยให้เกิดกลิ่นหรือคราบสกปรก',
  },
  {
    id: 'safety_lock',
    label: '🔐 ล็อคประตูและดูแลทรัพย์สิน',
    cleanText: 'กรุณาล็อคประตูห้องพักทุกครั้งเมื่อออกไปข้างนอก ทางหอพักไม่รับผิดชอบกรณีทรัพย์สินสูญหาย',
  },
];

/**
 * Strips leading numbering (e.g. "1.", "2)") or bullet points (e.g. "•") and trims.
 */
export function cleanRuleText(line: string): string {
  return line.replace(/^\s*(?:•|\d+[\.\)])\s*/, '').trim();
}

/**
 * Parses raw multiline text into an array of clean rule strings.
 */
export function parseRuleLines(text: string): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => cleanRuleText(line))
    .filter((line) => line.length > 0);
}

/**
 * Formats an array of rules into sequentially numbered lines:
 * 1. Rule one
 * 2. Rule two
 */
export function formatNumberedRules(rules: string[]): string {
  const cleaned = rules
    .map((r) => cleanRuleText(r))
    .filter((r) => r.length > 0);

  return cleaned.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n');
}

/**
 * Checks whether a rule is currently active in the text block.
 */
export function isRuleActive(currentText: string, targetCleanText: string): boolean {
  const lines = parseRuleLines(currentText);
  const target = targetCleanText.trim();
  return lines.some((l) => l === target);
}

/**
 * Toggles a rule in the text block:
 * - If already present, removes it and renumbers remaining lines sequentially.
 * - If not present, appends it as the next numbered line.
 */
export function toggleRuleInNumberedList(currentText: string, targetCleanText: string): string {
  const lines = parseRuleLines(currentText);
  const target = targetCleanText.trim();
  const exists = lines.some((l) => l === target);

  let nextLines: string[];
  if (exists) {
    nextLines = lines.filter((l) => l !== target);
  } else {
    nextLines = [...lines, target];
  }
  return formatNumberedRules(nextLines);
}
