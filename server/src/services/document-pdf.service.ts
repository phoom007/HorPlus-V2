import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';

export interface ContractPdfData {
  contractNumber: string;
  dormitoryName: string;
  dormitoryAddress?: string | null;
  dormitoryPhone?: string | null;
  ownerName: string;
  ownerSignatureUrl?: string | null;
  tenantName: string;
  tenantPhone?: string | null;
  coTenants?: Array<{ name: string; phone?: string }>;
  buildingName?: string | null;
  roomNumber: string;
  rentBillingType: 'monthly' | 'term';
  startDate: string;
  endDate: string;
  rentAmount: string;
  depositAmount: string;
  waterRate: string;
  electricityRate: string;
  commonFee: string;
  internetFee?: string;
  billingDay: number;
  dueDay: number;
  lateFeeMode?: string;
  lateFeeAmount?: string;
  maxInstallmentsAllowed?: number;
  installmentCount?: number; // 1 or more
  installmentSchedule?: Array<{ installmentNo: number; amount: string; cycleName: string }>;
  tenantSignature?: string | null;
  terms?: string | null;
  createdAt?: string;
}


export class DocumentPdfService {
  /**
   * Helper to register fontkit and load embedded TTF custom font (Tahoma/Sarabun) or standard font fallback.
   */
  private async loadFonts(pdfDoc: PDFDocument) {
    pdfDoc.registerFontkit(fontkit);
    const notoPath = path.join(process.cwd(), 'assets', 'fonts', 'noto-sans-thai-regular.woff');
    const notoBoldPath = path.join(process.cwd(), 'assets', 'fonts', 'noto-sans-thai-bold.woff');
    const fontsourceNotoPath1 = path.join(process.cwd(), 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-400-normal.woff');
    const fontsourceNotoBoldPath1 = path.join(process.cwd(), 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-700-normal.woff');
    const fontsourceNotoPath2 = path.join(process.cwd(), 'server', 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-400-normal.woff');
    const fontsourceNotoBoldPath2 = path.join(process.cwd(), 'server', 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-700-normal.woff');
    const tahomaPath = path.join(process.cwd(), 'assets', 'fonts', 'tahoma.ttf');
    const tahomaBoldPath = path.join(process.cwd(), 'assets', 'fonts', 'tahomabd.ttf');

    if (fs.existsSync(notoPath) && fs.existsSync(notoBoldPath)) {
      const font = await pdfDoc.embedFont(fs.readFileSync(notoPath));
      const fontBold = await pdfDoc.embedFont(fs.readFileSync(notoBoldPath));
      return { font, fontBold };
    } else if (fs.existsSync(fontsourceNotoPath1) && fs.existsSync(fontsourceNotoBoldPath1)) {
      const font = await pdfDoc.embedFont(fs.readFileSync(fontsourceNotoPath1));
      const fontBold = await pdfDoc.embedFont(fs.readFileSync(fontsourceNotoBoldPath1));
      return { font, fontBold };
    } else if (fs.existsSync(fontsourceNotoPath2) && fs.existsSync(fontsourceNotoBoldPath2)) {
      const font = await pdfDoc.embedFont(fs.readFileSync(fontsourceNotoPath2));
      const fontBold = await pdfDoc.embedFont(fs.readFileSync(fontsourceNotoBoldPath2));
      return { font, fontBold };
    } else if (fs.existsSync(tahomaPath) && fs.existsSync(tahomaBoldPath)) {
      const font = await pdfDoc.embedFont(fs.readFileSync(tahomaPath));
      const fontBold = await pdfDoc.embedFont(fs.readFileSync(tahomaBoldPath));
      return { font, fontBold };
    } else {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      return { font, fontBold };
    }
  }

  /**
   * Generates a server-authoritative Lease Contract PDF document with full Thai Unicode support.
   */
  public async generateContractPdf(data: ContractPdfData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setCreationDate(data.createdAt ? new Date(data.createdAt) : new Date('2026-01-01T00:00:00.000Z'));
    pdfDoc.setModificationDate(data.createdAt ? new Date(data.createdAt) : new Date('2026-01-01T00:00:00.000Z'));
    const { font, fontBold } = await this.loadFonts(pdfDoc);

    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    let y = height - 50;

    // Header
    page.drawText('หนังสือสัญญาเช่าห้องพัก (Lease Agreement)', {
      x: 50,
      y,
      size: 16,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.5),
    });
    y -= 25;

    page.drawText(`สัญญาเลขที่: ${data.contractNumber}`, {
      x: 50,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(`วันที่ทำสัญญา: ${data.createdAt || data.startDate}`, {
      x: width - 220,
      y,
      size: 10,
      font,
    });
    y -= 20;

    // Divider
    page.drawLine({
      start: { x: 50, y },
      end: { x: width - 50, y },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 20;

    const safeDormName = this.safeText(data.dormitoryName, 'หอพัก');
    const safeOwnerName = this.safeText(data.ownerName, 'เจ้าของหอพัก');
    const safeTenantName = this.safeText(data.tenantName, 'ผู้เช่า');
    const safeAddress = this.safeText(data.dormitoryAddress, '');

    // Party Information
    page.drawText(`1. คู่สัญญาและสถานที่เช่า (PARTIES & PREMISES)`, { x: 50, y, size: 12, font: fontBold });
    y -= 18;
    page.drawText(`ผู้ให้เช่า / หอพัก: ${safeDormName} (เจ้าของ: ${safeOwnerName})`, { x: 60, y, size: 10, font });
    y -= 15;
    if (safeAddress) {
      page.drawText(`ที่อยู่: ${safeAddress}`, { x: 60, y, size: 9, font });
      y -= 15;
    }
    page.drawText(`ผู้เช่า: ${safeTenantName} (เบอร์โทร: ${data.tenantPhone || 'N/A'})`, { x: 60, y, size: 10, font });
    y -= 15;
    if (data.coTenants && data.coTenants.length > 0) {
      const coText = data.coTenants.map((c) => `${this.safeText(c.name, 'ผู้พักร่วม')} (${c.phone || 'N/A'})`).join(', ');
      page.drawText(`ผู้พักอาศัยร่วม: ${coText}`, { x: 60, y, size: 9, font });
      y -= 15;
    }
    const roomStr = data.buildingName ? `${this.safeText(data.buildingName, 'อาคาร')} - ห้อง ${data.roomNumber}` : `ห้อง ${data.roomNumber}`;
    page.drawText(`ห้องพักที่เช่า: ${roomStr}`, { x: 60, y, size: 10, font: fontBold });
    y -= 25;

    // Lease Terms & Rates
    page.drawText(`2. ระยะเวลาเช่าและอัตราค่าเช่า (LEASE TERMS & RATES)`, { x: 50, y, size: 12, font: fontBold });
    y -= 18;
    const typeLabel = data.rentBillingType === 'term' ? 'สัญญาเช่ารายเทอม (Semester Contract)' : 'สัญญาเช่ารายเดือน (Monthly Contract)';
    page.drawText(`ประเภทสัญญา: ${typeLabel}`, { x: 60, y, size: 10, font });
    y -= 15;
    page.drawText(`ระยะเวลาสัญญา: ${data.startDate} ถึง ${data.endDate}`, { x: 60, y, size: 10, font });
    y -= 15;
    page.drawText(`ค่าเช่าห้องพัก: ${data.rentAmount} บาท/เดือน | เงินประกันสัญญา: ${data.depositAmount} บาท`, { x: 60, y, size: 10, font: fontBold });
    y -= 15;
    page.drawText(`อัตราค่าสาธารณูปโภค: ค่าน้ำ ${data.waterRate} บาท/หน่วย | ค่าไฟ ${data.electricityRate} บาท/หน่วย`, { x: 60, y, size: 9, font });
    y -= 15;
    page.drawText(`ค่าส่วนกลาง: ${data.commonFee} บาท/เดือน | ค่าอินเทอร์เน็ต: ${data.internetFee || '0.00'} บาท/เดือน`, { x: 60, y, size: 9, font });
    y -= 15;
    page.drawText(`กำหนดการชำระ: ตัดรอบวันที่ ${data.billingDay} | ครบกำหนดชำระวันที่ ${data.dueDay} ของเดือน`, { x: 60, y, size: 9, font });
    y -= 25;

    // Semester Installments Breakdown (If Semester Contract)
    if (data.rentBillingType === 'term') {
      page.drawText(`3. ตารางงวดชำระค่าเช่ารายเทอม (SEMESTER INSTALLMENT SCHEDULE)`, { x: 50, y, size: 12, font: fontBold });
      y -= 18;
      const count = data.installmentCount || 1;
      const modeText = count > 1 ? `แบ่งชำระเป็น ${count} งวด (สูงสุดไม่เกิน ${data.maxInstallmentsAllowed || count} งวด)` : `ชำระค่าเช่ารายเทอมเต็มจำนวนในงวดแรก`;
      page.drawText(`รูปแบบการชำระเงิน: ${modeText}`, { x: 60, y, size: 10, font });
      y -= 18;

      if (data.installmentSchedule && data.installmentSchedule.length > 0) {
        for (const inst of data.installmentSchedule) {
          page.drawText(`งวดที่ #${inst.installmentNo}: ${inst.amount} บาท (${inst.cycleName})`, { x: 70, y, size: 9, font });
          y -= 14;
        }
      }
      y -= 15;
    }

    // Signatures Section
    y = Math.min(y, 180);
    page.drawLine({
      start: { x: 50, y },
      end: { x: width - 50, y },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 25;

    page.drawText(`4. ลงนามลายมือชื่อ (SIGNATURES & FINALIZATION)`, { x: 50, y, size: 12, font: fontBold });
    y -= 35;

    // Owner Signature Box
    page.drawText(`________________________`, { x: 70, y, size: 10, font });
    page.drawText(`________________________`, { x: 350, y, size: 10, font });
    y -= 15;
    page.drawText(`ผู้ให้เช่า: ${safeOwnerName}`, { x: 70, y, size: 9, font });
    page.drawText(`ผู้เช่า: ${safeTenantName}`, { x: 350, y, size: 9, font });
    y -= 15;
    page.drawText(`วันที่: ${data.createdAt || data.startDate}`, { x: 70, y, size: 8, font });
    page.drawText(`วันที่: ${data.createdAt || data.startDate}`, { x: 350, y, size: 8, font });

    // Embed Tenant Signature image if valid base64 provided
    if (data.tenantSignature && data.tenantSignature.startsWith('data:image/')) {
      try {
        const base64Data = data.tenantSignature.split(',')[1];
        const imageBytes = Buffer.from(base64Data, 'base64');
        const img = data.tenantSignature.includes('jpeg') || data.tenantSignature.includes('jpg')
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);
        page.drawImage(img, {
          x: 350,
          y: y + 25,
          width: 100,
          height: 35,
        });
      } catch (err) {
        // Fallback gracefully if image parsing fails
      }
    }

    // Footer
    page.drawText(`หนังสือสัญญาเช่าฉบับสมบูรณ์ — ระบบบริหารจัดการหอพัก HorPlus — หน้า 1 จาก 1`, {
      x: 50,
      y: 25,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }


  private safeText(str?: string | null, fallback = ''): string {
    if (!str) return fallback;
    // Retain all valid printable characters including Thai unicode, numbers, letters, symbols, slashes, hyphens
    const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    return cleaned || fallback;
  }
}
