import { describe, it, expect } from 'vitest';
import { sanitizeContractTerms } from '../utils/contract-terms-sanitizer';

describe('sanitizeContractTerms', () => {
  const sampleDormRules = `1. ห้ามสูบบุหรี่ภายในห้องพักและบริเวณทางเดิน
2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22.00 น.
3. ห้ามนำสัตว์เลี้ยงเข้ามาในบริเวณหอพัก
4. รักษาความสะอาดของห้องพักและพื้นที่ส่วนกลาง
5. ชำระค่าเช่าและค่าน้ำค่าไฟภายในวันที่ 5 ของทุกเดือน`;

  const sampleFullContract = `ข้อ 1. ทรัพย์สินที่เช่า: ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข ห้อง 101 ของอาคาร อาคาร A พร้อมอุปกรณ์ เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า และสิ่งอำนวยความสะดวกในสภาพเรียบร้อยสมบูรณ์
ข้อ 2. อัตราค่าเช่า เงินประกัน และการคืนเงิน: ผู้เช่าตกลงชำระค่าเช่าในอัตรา ฿ 4,500.00 บาทต่อเดือน กำหนดชำระตามรอบบิลที่หอพักกำหนด พร้อมวางเงินประกันความเสียหายจำนวน ฿ 9,000.00 บาท โดยเงินประกันนี้จะได้รับคืนเมื่อสิ้นสุดสัญญาเช่า หลังจากหักค่าใช้จ่ายค้างชำระ หนี้สิน หรือค่าความเสียหายต่อทรัพย์สิน (ถ้ามี) ตามระเบียบและเงื่อนไขที่หอพักกำหนด
ข้อ 3. ระยะเวลาการเช่า: สัญญานี้มีกำหนดระยะเวลา 12 เดือน โดยเริ่มต้นตั้งแต่วันที่ 1 มกราคม 2567 ถึงวันที่ 31 ธันวาคม 2567
ข้อ 4. ยานพาหนะ สัตว์เลี้ยง และการใช้พื้นที่ส่วนกลาง: ผู้เช่าตกลงปฏิบัติตามระเบียบการจอดยานพาหนะ การนำสัตว์เลี้ยงเข้าพัก (หากหอพักอนุญาต) และการใช้พื้นที่ส่วนกลาง โดยต้องบันทึกข้อมูลยานพาหนะและสัตว์เลี้ยงลงในระบบของหอพักให้ถูกต้องตรงตามความเป็นจริง
ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม: ผู้เช่าตกลงแจ้งข้อมูลผู้พักอาศัยในห้องพักตามความเป็นจริง โดยในวันทำสัญญามีผู้เช่าหลักและผู้พักอาศัยร่วม รวมทั้งสิ้น 1 คน หากมีการเปลี่ยนแปลงหรือมีผู้พักอาศัยร่วมเพิ่มเติมในภายหลัง ผู้เช่าจะต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าและบันทึกข้อมูลลงในระบบตามระเบียบของหอพัก
ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:
${sampleDormRules}`;

  it('กรณีที่ 1: ตัดข้อ 1-5 ออก และดึงเฉพาะเนื้อหาหลังจาก "ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:" ออกมา (trim whitespace)', () => {
    const result = sanitizeContractTerms(sampleFullContract);
    expect(result).toBe(sampleDormRules);
    expect(result).not.toContain('ข้อ 1. ทรัพย์สินที่เช่า');
    expect(result).not.toContain('ข้อ 2. อัตราค่าเช่า');
    expect(result).not.toContain('ข้อ 5. จำนวนผู้พักอาศัย');
    expect(result).not.toContain('ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย');
  });

  it('กรณีที่ 1 (variation): รองรับข้อ 6 แบบไม่มี colon หรือมีช่องว่างขึ้นบรรทัดใหม่', () => {
    const contractWithoutColon = `ข้อ 1. ทรัพย์สินที่เช่า: ห้อง 101
ข้อ 2. อัตราค่าเช่า: 4,500 บาท
ข้อ 3. ระยะเวลาการเช่า: 12 เดือน
ข้อ 4. ยานพาหนะ: รถยนต์ 1 คัน
ข้อ 5. จำนวนผู้พักอาศัย: 1 คน
ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย
1. ห้ามเลี้ยงสัตว์
2. ห้ามเสียงดัง`;

    const result = sanitizeContractTerms(contractWithoutColon);
    expect(result).toBe('1. ห้ามเลี้ยงสัตว์\n2. ห้ามเสียงดัง');
  });

  it('กรณีที่ 2: ถ้า rawTerms ขึ้นต้นด้วย "ข้อ 1. ทรัพย์สินที่เช่า" แต่ไม่มี "ข้อ 6." ให้ตัดย่อหน้าข้อ 1 ถึงข้อ 5 ออก', () => {
    const contractWithoutClause6 = `ข้อ 1. ทรัพย์สินที่เช่า: ผู้ให้เช่าตกลงให้เช่า ห้อง 101
ข้อ 2. อัตราค่าเช่า เงินประกัน: ค่าเช่า 4,500 บาท
ข้อ 3. ระยะเวลาการเช่า: 12 เดือน
ข้อ 4. ยานพาหนะ สัตว์เลี้ยง: ไม่มีสัตว์เลี้ยง
ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม: 1 คน
1. กฎระเบียบข้อที่หนึ่ง
2. กฎระเบียบข้อที่สอง`;

    const result = sanitizeContractTerms(contractWithoutClause6);
    expect(result).toBe('1. กฎระเบียบข้อที่หนึ่ง\n2. กฎระเบียบข้อที่สอง');
    expect(result).not.toContain('ข้อ 1. ทรัพย์สินที่เช่า');
    expect(result).not.toContain('ข้อ 5. จำนวนผู้พักอาศัย');
  });

  it('กรณีที่ 2 (เฉพาะข้อ 1-5 ไม่มีกฎต่อท้าย): คืนค่าว่าง หรือ fallback เมื่อไม่มีเนื้อหากฎระเบียบหลงเหลือ', () => {
    const onlyClauses1To5 = `ข้อ 1. ทรัพย์สินที่เช่า: ผู้ให้เช่าตกลงให้เช่า ห้อง 101
ข้อ 2. อัตราค่าเช่า: 4,500 บาท
ข้อ 3. ระยะเวลาการเช่า: 12 เดือน
ข้อ 4. ยานพาหนะ: ไม่มี
ข้อ 5. จำนวนผู้พักอาศัย: 1 คน`;

    const result = sanitizeContractTerms(onlyClauses1To5);
    expect(result).toBe('');

    const withFallback = sanitizeContractTerms(onlyClauses1To5, 'ระเบียบเริ่มต้น');
    expect(withFallback).toBe('ระเบียบเริ่มต้น');
  });

  it('กรณีที่ 3: ถ้า rawTerms เป็นระเบียบหอพักปกติโดยไม่มีข้อ 1-5 ให้คืนค่าเดิมตามปกติ', () => {
    const result = sanitizeContractTerms(sampleDormRules);
    expect(result).toBe(sampleDormRules);

    const customOwnerRules = 'ห้ามส่งเสียงดังหลัง 4 ทุ่ม และรักษาความสะอาด';
    expect(sanitizeContractTerms(customOwnerRules)).toBe(customOwnerRules);
  });

  it('กรณีที่ 4: ถ้า rawTerms เป็น null/undefined/empty string ให้คืนค่า "" หรือ default fallback', () => {
    expect(sanitizeContractTerms(null)).toBe('');
    expect(sanitizeContractTerms(undefined)).toBe('');
    expect(sanitizeContractTerms('')).toBe('');
    expect(sanitizeContractTerms('   ')).toBe('');

    expect(sanitizeContractTerms(null, 'default rules')).toBe('default rules');
    expect(sanitizeContractTerms(undefined, 'default rules')).toBe('default rules');
    expect(sanitizeContractTerms('', 'default rules')).toBe('default rules');
    expect(sanitizeContractTerms('   ', 'default rules')).toBe('default rules');
  });
});
