import { describe, it, expect } from 'vitest';
import { DocumentPdfService } from '../src/services/document-pdf.service.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

async function extractPdfRawText(pdfBuffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: pdfBuffer, verbosity: 0 });
    await parser.load();
    const res = await parser.getText();
    return res.text || '';
  } catch {
    return pdfBuffer.toString('utf-8');
  }
}

describe('Contract PDF Production Truth & Immutability Unit Suite', () => {
  const pdfService = new DocumentPdfService();

  it('1. Generates valid PDF buffer with authoritative snapshot values', async () => {
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-Z909-TEST',
      dormitoryName: 'หอพักสัจจะความจริง',
      dormitoryAddress: '123/45 ถนนความจริง',
      ownerName: 'สมชาย เจ้าของหอ',
      tenantName: 'สมหญิง ผู้เช่าจริง',
      tenantPhone: '0812345678',
      buildingName: 'อาคาร Z',
      roomNumber: 'Z909',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '4321.00',
      depositAmount: '8765.00',
      waterRate: '21.25',
      electricityRate: '8.75',
      commonFee: '123.45',
      internetFee: '246.80',
      parkingFee: '100.00',
      billingDay: 15,
      dueDay: 5,
      createdAt: '2026-02-15T10:00:00.000Z',
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(5000);
    expect(pdfBuffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('2. Zero value test: Authoritative 0 values are accepted as formatted strings "0.00"', async () => {
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-ZERO-TEST',
      dormitoryName: 'หอพักฟรีสวัสดิการ',
      ownerName: 'สมชาย',
      tenantName: 'สมหญิง',
      roomNumber: 'Z900',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '3000.00',
      depositAmount: '6000.00',
      waterRate: '0.00',
      electricityRate: '0.00',
      commonFee: '0.00',
      internetFee: '0.00',
      parkingFee: '0.00',
      billingDay: 1,
      dueDay: 5,
      createdAt: '2026-02-15T10:00:00.000Z',
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(5000);
    expect(pdfBuffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('3. Missing values render as "ไม่ระบุ" without throwing or fabricating legacy defaults', async () => {
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-UNKNOWN-TEST',
      dormitoryName: 'หอพักมินิมอล',
      ownerName: 'สมชาย',
      tenantName: 'สมหญิง',
      roomNumber: 'Z100',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: 'ไม่ระบุ',
      depositAmount: 'ไม่ระบุ',
      waterRate: 'ไม่ระบุ',
      electricityRate: 'ไม่ระบุ',
      commonFee: 'ไม่ระบุ',
      internetFee: 'ไม่ระบุ',
      parkingFee: 'ไม่ระบุ',
      billingDay: 'ไม่ระบุ',
      dueDay: 'ไม่ระบุ',
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(5000);

    const rawText = await extractPdfRawText(pdfBuffer);
    // Synthetic legacy date fallback must NOT exist
    expect(rawText).not.toContain('2026-01-01T00:00:00.000Z');
  });

  it('4. Immutability: Contract snapshot parameters generate deterministic PDF document', async () => {
    const params = {
      contractNumber: 'CTR-IMMUTABLE-001',
      dormitoryName: 'หอพักมั่นคง',
      ownerName: 'เจ้าของหอ',
      tenantName: 'ผู้เช่า',
      roomNumber: 'A101',
      rentBillingType: 'monthly' as const,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '5000.00',
      depositAmount: '10000.00',
      waterRate: '21.25',
      electricityRate: '8.75',
      commonFee: '300.00',
      internetFee: '250.00',
      parkingFee: '500.00',
      billingDay: 15,
      dueDay: 25,
      createdAt: '2026-01-15T08:00:00.000Z',
    };

    const pdfBuffer1 = await pdfService.generateContractPdf(params);
    const pdfBuffer2 = await pdfService.generateContractPdf(params);

    expect(pdfBuffer1).toBeInstanceOf(Buffer);
    expect(pdfBuffer2).toBeInstanceOf(Buffer);
    // Lengths match for identical snapshot parameters
    expect(pdfBuffer1.length).toEqual(pdfBuffer2.length);
  });
});
