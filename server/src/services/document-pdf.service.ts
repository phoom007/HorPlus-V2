import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { chromium, type Browser } from 'playwright';

export interface ContractPdfData {
  contractNumber: string;
  dormitoryName: string;
  dormitoryAddress?: string | null;
  dormitoryPhone?: string | null;
  ownerName: string;
  ownerSignatureUrl?: string | null;
  tenantName: string;
  tenantCitizenId?: string | null;
  tenantPhone?: string | null;
  coTenants?: Array<{ name: string; phone?: string }>;
  buildingName?: string | null;
  floor?: string | number | null;
  roomNumber: string;
  rentBillingType: 'monthly' | 'term';
  startDate: string;
  endDate: string;
  durationMonths?: number | string | null;
  rentAmount: string;
  depositAmount: string;
  depositType?: string | null;
  advancePaymentAmount?: string | number | null;
  waterRate: string;
  electricityRate: string;
  commonFee: string;
  internetFee?: string;
  parkingFee?: string;
  billingDay: number | string;
  dueDay: number | string;
  lateFeeMode?: string;
  lateFeeAmount?: string;
  maxInstallmentsAllowed?: number;
  installmentCount?: number; // 1 or more
  installmentSchedule?: Array<{ installmentNo: number; amount: string; cycleName: string }>;
  tenantSignature?: string | null;
  terms?: string | null;
  createdAt?: string;
}

/**
 * Escapes characters for safe interpolation into HTML.
 */
export function escapeHtml(str?: string | number | null, fallback = ''): string {
  if (str === undefined || str === null) return fallback;
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates that a signature URL is strictly a base64 encoded image data URL.
 * Rejects any http:, https:, file:, javascript:, or arbitrary payloads to prevent SSRF.
 */
export function isValidSignatureDataUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed);
}

/**
 * Asynchronous semaphore to bound concurrent PDF generation requests.
 */
export class AsyncPdfSemaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(public readonly max: number = 2) {}

  async acquire(timeoutMs = 30000): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const callback = () => {
        if (timer) clearTimeout(timer);
        this.current++;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      };

      timer = setTimeout(() => {
        const idx = this.queue.indexOf(callback);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new Error('PDF generation queue timeout: server busy, please try again'));
      }, timeoutMs);

      this.queue.push(callback);
    });
  }

  private release(): void {
    this.current--;
    if (this.queue.length > 0 && this.current < this.max) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  getActiveCount(): number {
    return this.current;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

/**
 * Managed reusable Playwright Chromium browser singleton with automatic restart on disconnection.
 */
export class SharedChromiumManager {
  private static browserInstance: Browser | null = null;
  private static launchPromise: Promise<Browser> | null = null;
  private static semaphore = new AsyncPdfSemaphore(2);

  static getSemaphore(): AsyncPdfSemaphore {
    return this.semaphore;
  }

  static async getBrowser(): Promise<Browser> {
    if (this.browserInstance && this.browserInstance.isConnected()) {
      return this.browserInstance;
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      try {
        const browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        });

        browser.on('disconnected', () => {
          SharedChromiumManager.browserInstance = null;
        });

        SharedChromiumManager.browserInstance = browser;
        return browser;
      } finally {
        SharedChromiumManager.launchPromise = null;
      }
    })();

    return this.launchPromise;
  }

  static async closeBrowser(): Promise<void> {
    if (this.browserInstance) {
      try {
        await this.browserInstance.close();
      } catch {}
      this.browserInstance = null;
    }
  }

  static isBrowserActive(): boolean {
    return !!(this.browserInstance && this.browserInstance.isConnected());
  }
}

export class DocumentPdfService {
  /**
   * Generates authentic HTML for the Official Thai Lease Agreement (matching PO Image 3).
   * Formatted with Sarabun font, Clauses 1-6, BE dates, two-party signatures, and clean layout.
   */
  public generateContractHtml(data: ContractPdfData): string {
    const safeDormName = escapeHtml(this.safeText(data.dormitoryName, 'หอพัก'));
    const safeOwnerName = escapeHtml(this.safeText(data.ownerName, 'เจ้าของหอพัก'));
    const rawTenantName = this.safeText(data.tenantName, 'ผู้เช่า');
    const hasTitlePrefix = /^(นาย|นาง|นางสาว|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|ดร\.|ดร\s|ผศ\.|ผศ\s|รศ\.|รศ\s|ศ\.|ศ\s|อาจารย์|ว่าที่ร้อยตรี|คุณ)/i.test(rawTenantName.trim());
    const formattedTenantName = escapeHtml(hasTitlePrefix ? rawTenantName : `คุณ${rawTenantName}`);
    const safeAddress = escapeHtml(this.safeText(data.dormitoryAddress, 'อาคารพักอาศัยส่วนบุคคล'));
    const tenantCitizenId = escapeHtml(this.safeText(data.tenantCitizenId, '-'));
    const tenantPhone = escapeHtml(this.safeText(data.tenantPhone, '-'));
    const roomNum = escapeHtml(this.safeText(data.roomNumber, '101'));
    const roomFloor = data.floor ? ` (ชั้น ${escapeHtml(String(data.floor))})` : '';

    const createdDateStr = data.createdAt ? data.createdAt.split('T')[0] : data.startDate;
    const createdDateThai = escapeHtml(this.formatThaiDate(createdDateStr));
    const startDateThai = escapeHtml(this.formatThaiDate(data.startDate));
    const endDateThai = escapeHtml(this.formatThaiDate(data.endDate));
    const duration = data.durationMonths ? Number(data.durationMonths) : this.calculateDurationMonths(data.startDate, data.endDate);

    const isTermContract = data.rentBillingType === 'term';
    const contractTypeLabel = isTermContract ? 'สัญญาเช่ารายเทอม' : 'สัญญาเช่ารายเดือน';
    const rentFormatted = escapeHtml(this.formatBaht(data.rentAmount));
    const depositFormatted = escapeHtml(this.formatBaht(data.depositAmount));
    const advanceFormatted = data.advancePaymentAmount && Number(data.advancePaymentAmount) > 0 ? escapeHtml(this.formatBaht(data.advancePaymentAmount)) : null;
    const depositTypeText = data.depositType === 'deduct_rent'
      ? 'นำไปหักชำระกับค่าเช่างวดสุดท้าย'
      : 'คืนให้เต็มจำนวนเมื่อสิ้นสุดสัญญาโดยไม่มีสิ่งของชำรุดเสียหาย';

    const coTenants = Array.isArray(data.coTenants) ? data.coTenants : [];
    const totalOccupants = 1 + coTenants.length;

    const waterRateStr = data.waterRate !== undefined && data.waterRate !== null ? `${escapeHtml(String(data.waterRate))} บาท/หน่วย` : 'ไม่ระบุ';
    const elecRateStr = data.electricityRate !== undefined && data.electricityRate !== null ? `${escapeHtml(String(data.electricityRate))} บาท/หน่วย` : 'ไม่ระบุ';
    const commonFeeStr = data.commonFee !== undefined && data.commonFee !== null ? `${escapeHtml(String(data.commonFee))} บาท/เดือน` : 'ไม่ระบุ';
    const internetFeeStr = data.internetFee && data.internetFee !== '0.00' && data.internetFee !== 'ไม่ระบุ' ? `, ค่าอินเทอร์เน็ต ${escapeHtml(data.internetFee)} บาท/เดือน` : '';
    const parkingFeeStr = data.parkingFee && data.parkingFee !== '0.00' && data.parkingFee !== 'ไม่ระบุ' ? `, ค่าที่จอดรถ ${escapeHtml(data.parkingFee)} บาท/เดือน` : '';
    const billingDayStr = data.billingDay !== undefined && data.billingDay !== null ? escapeHtml(String(data.billingDay)) : 'ไม่ระบุ';
    const dueDayStr = data.dueDay !== undefined && data.dueDay !== null ? escapeHtml(String(data.dueDay)) : 'ไม่ระบุ';

    const rawTerms = this.safeText(
      data.terms,
      '1. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง\n2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.\n3. ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา ภายในวันที่ 5 ของทุกเดือน\n4. ห้ามนำบุคคลภายนอกมาพักค้างคืนโดยไม่แจ้งเจ้าหน้าที่\n5. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด'
    );
    const termsText = escapeHtml(rawTerms);

    const isTenantSigValid = isValidSignatureDataUrl(data.tenantSignature);
    const tenantSigHtml = isTenantSigValid
      ? `<img src="${data.tenantSignature!.trim()}" alt="ลายเซ็นผู้เช่า" style="max-height: 48px; max-width: 150px; object-fit: contain;" />`
      : `<div style="height: 44px; border-bottom: 1px dotted #94a3b8; width: 140px; margin: 0 auto;"></div>`;

    const isOwnerSigValid = isValidSignatureDataUrl(data.ownerSignatureUrl);
    const ownerSigHtml = isOwnerSigValid
      ? `<img src="${data.ownerSignatureUrl!.trim()}" alt="ลายเซ็นผู้ให้เช่า" style="max-height: 48px; max-width: 150px; object-fit: contain;" />`
      : `<div style="height: 44px; border-bottom: 1px dotted #94a3b8; width: 140px; margin: 0 auto;"></div>`;

    let installmentsHtml = '';
    if (isTermContract && data.installmentSchedule && data.installmentSchedule.length > 0) {
      installmentsHtml = `
        <div style="margin-top: 10px; padding: 10px 14px; background-color: #f1f5f9; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; color: #1e293b;">ตารางงวดชำระค่าเช่ารายเทอม:</div>
          <table style="width: 100%; font-size: 11.5px; border-collapse: collapse;">
            ${data.installmentSchedule.map(s => `
              <tr>
                <td style="padding: 4px 6px; color: #475569;">งวดที่ #${escapeHtml(String(s.installmentNo))} (${escapeHtml(s.cycleName)})</td>
                <td style="padding: 4px 6px; text-align: right; font-weight: 700; color: #0f172a;">฿ ${this.formatBaht(s.amount)} บาท</td>
              </tr>
            `).join('')}
          </table>
        </div>
      `;
    }

    const safeContractNumber = escapeHtml(this.safeText(data.contractNumber, 'CTR'));

    return `
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>สัญญาเช่าห้องพักเลขที่ ${safeContractNumber} - ห้อง ${roomNum}${roomFloor}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4;
            margin: 15mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: 'Sarabun', 'Segoe UI', Tahoma, -apple-system, sans-serif;
            font-size: 13.5px;
            line-height: 1.65;
            color: #0f172a;
            background-color: #ffffff;
            margin: 0;
            padding: 0;
          }
          .contract-container {
            width: 100%;
            max-width: 100%;
            margin: 0 auto;
            background: #ffffff;
          }
          .header-box {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 14px;
            border-bottom: 2px solid #0f172a;
          }
          .title {
            font-size: 20px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 6px 0;
            letter-spacing: 0.5px;
          }
          .contract-no {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
          }
          .content-section {
            margin-bottom: 16px;
            text-align: justify;
            text-justify: inter-word;
          }
          .highlight-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 18px;
            margin: 16px 0;
          }
          .highlight-box ul {
            margin: 0;
            padding-left: 20px;
          }
          .highlight-box li {
            margin-bottom: 7px;
          }
          .highlight-box li:last-child {
            margin-bottom: 0;
          }
          .terms-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 12px 16px;
            margin-top: 8px;
            white-space: pre-line;
            color: #334155;
            font-size: 12.5px;
            line-height: 1.7;
          }
          .signatures-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-top: 36px;
            page-break-inside: avoid;
          }
          .signature-block {
            text-align: center;
            border: none;
            padding: 18px 12px 14px 12px;
            background-color: transparent;
          }
          .signature-label {
            font-weight: 700;
            font-size: 13px;
            color: #1e293b;
            margin-bottom: 12px;
          }
          .signature-space {
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 8px;
          }
          .signer-name {
            font-size: 13px;
            font-weight: 600;
            color: #334155;
          }
        </style>
      </head>
      <body>
        <div class="contract-container">
          <div class="header-box">
            <div class="title">หนังสือสัญญาเช่าห้องพักอาศัย</div>
            <div class="contract-no">สัญญาเลขที่: <strong>${safeContractNumber}</strong> | วันที่ทำสัญญา: <strong>${createdDateThai}</strong></div>
            <div style="font-size: 12.5px; color: #64748b; margin-top: 4px;">ทำที่: ${safeDormName} (${safeAddress})</div>
          </div>

          <div class="content-section">
            <p style="margin: 0 0 12px 0; text-indent: 32px;">
              สัญญาฉบับนี้ทำขึ้นระหว่าง <strong>${safeDormName}</strong> โดย <strong>${safeOwnerName}</strong> ("ผู้ให้เช่า") ฝ่ายหนึ่ง กับ <strong>${formattedTenantName}</strong> ถือบัตรประจำตัวประชาชนเลขที่ <strong>${tenantCitizenId}</strong> เบอร์โทรศัพท์ <strong>${tenantPhone}</strong> ("ผู้เช่า") อีกฝ่ายหนึ่ง โดยคู่สัญญาทั้งสองฝ่ายได้ตกลงทำสัญญากันตามข้อกำหนดและเงื่อนไขดังต่อไปนี้:
            </p>
          </div>

          <div class="highlight-box">
            <ul>
              <li><strong>ข้อ 1. ทรัพย์สินที่เช่า:</strong> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข <strong>ห้อง ${roomNum}${roomFloor}</strong> ของอาคาร <strong>${safeDormName}</strong> พร้อมอุปกรณ์ เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า และสิ่งอำนวยความสะดวกในสภาพเรียบร้อยสมบูรณ์</li>
              <li><strong>ข้อ 2. อัตราค่าเช่า เงินประกัน และการคืนเงิน:</strong> ผู้เช่าตกลงชำระค่าเช่าประเภท <strong>${contractTypeLabel}</strong> ในอัตรา <strong>฿ ${rentFormatted} บาทต่อ${isTermContract ? 'เทอม' : 'เดือน'}</strong> กำหนดชำระตามรอบบิลที่หอพักกำหนด (ตัดรอบบิลวันที่ ${billingDayStr} | ครบกำหนดชำระวันที่ ${dueDayStr} ของทุกเดือน) พร้อมวางเงินประกันความเสียหายจำนวน <strong>฿ ${depositFormatted} บาท</strong> โดยเงินประกันนี้จะได้รับคืนเมื่อสิ้นสุดสัญญาเช่า หลังจากหักค่าใช้จ่ายค้างชำระ หนี้สิน หรือค่าความเสียหายต่อทรัพย์สิน (ถ้ามี) ตามระเบียบและเงื่อนไขที่หอพักกำหนด</li>
              <li><strong>ข้อ 3. ระยะเวลาการเช่า:</strong> สัญญานี้มีกำหนดระยะเวลา <strong>${duration} เดือน</strong> โดยเริ่มต้นตั้งแต่วันที่ <strong>${startDateThai}</strong> ถึงวันที่ <strong>${endDateThai}</strong></li>
              <li><strong>ข้อ 4. ยานพาหนะ สัตว์เลี้ยง และการใช้พื้นที่ส่วนกลาง:</strong> ผู้เช่าตกลงปฏิบัติตามระเบียบการจอดยานพาหนะ การนำสัตว์เลี้ยงเข้าพัก (หากหอพักอนุญาต) และการใช้พื้นที่ส่วนกลาง โดยต้องบันทึกข้อมูลยานพาหนะและสัตว์เลี้ยงลงในระบบของหอพักให้ถูกต้องตรงตามความเป็นจริง</li>
              <li><strong>ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม:</strong> ผู้เช่าตกลงแจ้งข้อมูลผู้พักอาศัยในห้องพักตามความเป็นจริง โดยในวันทำสัญญามีผู้เช่าหลักและผู้พักอาศัยร่วม รวมทั้งสิ้น <strong>${totalOccupants} คน</strong> หากมีการเปลี่ยนแปลงหรือมีผู้พักอาศัยร่วมเพิ่มเติมในภายหลัง ผู้เช่าจะต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าและบันทึกข้อมูลลงในระบบตามระเบียบของหอพัก</li>
            </ul>
            ${installmentsHtml}
          </div>

          <div class="content-section">
            <strong>ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:</strong>
            <div class="terms-box">${termsText}</div>
          </div>

          <div class="content-section" style="margin-top: 14px;">
            <p style="margin: 0; text-indent: 32px;">
              สัญญานี้ทำขึ้นเป็นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาทั้งสองฝ่ายได้อ่านและเข้าใจข้อความโดยละเอียดแล้ว จึงได้ลงลายมือชื่อไว้เป็นหลักฐานสำคัญต่อหน้าพยาน
            </p>
          </div>

          <div class="signatures-grid">
            <div class="signature-block">
              <div class="signature-label">ลงชื่อ (ผู้ให้เช่า)</div>
              <div class="signature-space">${ownerSigHtml}</div>
              <div class="signer-name">(${safeOwnerName})</div>
            </div>

            <div class="signature-block">
              <div class="signature-label">ลงชื่อ (ผู้เช่า)</div>
              <div class="signature-space">${tenantSigHtml}</div>
              <div class="signer-name">(${formattedTenantName})</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generates a server-authoritative Lease Contract PDF document using Managed Headless Chromium.
   * Renders the authentic official Thai agreement template (matching PO Image 3) with Sarabun font.
   * Bounded concurrency (semaphore max 2) and SSRF-safe network routing (SEC-07 & PERF-01).
   */
  public async generateContractPdf(data: ContractPdfData): Promise<Buffer> {
    const html = this.generateContractHtml(data);
    const release = await SharedChromiumManager.getSemaphore().acquire();

    let context: any = null;
    let page: any = null;
    try {
      const browser = await SharedChromiumManager.getBrowser();
      context = await browser.newContext();
      page = await context.newPage();

      // SEC-07: Restrict network requests - allow only Google Fonts & data URLs, abort all others
      await page.route('**/*', (route: any) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith('data:')) {
          return route.continue();
        }
        try {
          const parsed = new URL(reqUrl);
          if (
            (parsed.hostname === 'fonts.googleapis.com' || parsed.hostname === 'fonts.gstatic.com') &&
            (parsed.protocol === 'https:' || parsed.protocol === 'http:')
          ) {
            return route.continue();
          }
        } catch {}

        return route.abort();
      });

      await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 });
      const rawPdfBytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          bottom: '15mm',
          left: '15mm',
          right: '15mm',
        },
      });

      // Ensure creationDate and modificationDate metadata match contractual timestamps
      const pdfDoc = await PDFDocument.load(rawPdfBytes);
      if (data.createdAt) {
        const createdDate = new Date(data.createdAt);
        if (!isNaN(createdDate.getTime())) {
          pdfDoc.setCreationDate(createdDate);
          pdfDoc.setModificationDate(createdDate);
        }
      }
      const finalPdfBytes = await pdfDoc.save();
      return Buffer.from(finalPdfBytes);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (context) {
        await context.close().catch(() => {});
      }
      release();
    }
  }

  /**
   * Closes the shared Playwright Chromium browser instance if active.
   */
  public static async closeSharedBrowser(): Promise<void> {
    await SharedChromiumManager.closeBrowser();
  }

  /**
   * Helper to register fontkit and load embedded TTF custom font (Tahoma/Sarabun) or standard font fallback.
   */
  private async loadFonts(pdfDoc: PDFDocument) {
    pdfDoc.registerFontkit(fontkit);
    const tahomaCandidates = [
      path.join(process.cwd(), 'assets', 'fonts', 'tahoma.ttf'),
      path.join(process.cwd(), 'server', 'assets', 'fonts', 'tahoma.ttf'),
      'C:/Windows/Fonts/tahoma.ttf',
    ];
    const tahomaBoldCandidates = [
      path.join(process.cwd(), 'assets', 'fonts', 'tahomabd.ttf'),
      path.join(process.cwd(), 'server', 'assets', 'fonts', 'tahomabd.ttf'),
      'C:/Windows/Fonts/tahomabd.ttf',
    ];

    const validTahoma = tahomaCandidates.find((p) => fs.existsSync(p));
    const validTahomaBold = tahomaBoldCandidates.find((p) => fs.existsSync(p));

    if (validTahoma && validTahomaBold) {
      const font = await pdfDoc.embedFont(fs.readFileSync(validTahoma));
      const fontBold = await pdfDoc.embedFont(fs.readFileSync(validTahomaBold));
      return { font, fontBold };
    }

    const notoPath = path.join(process.cwd(), 'assets', 'fonts', 'noto-sans-thai-regular.woff');
    const notoBoldPath = path.join(process.cwd(), 'assets', 'fonts', 'noto-sans-thai-bold.woff');
    const fontsourceNotoPath1 = path.join(process.cwd(), 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-400-normal.woff');
    const fontsourceNotoBoldPath1 = path.join(process.cwd(), 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-700-normal.woff');
    const fontsourceNotoPath2 = path.join(process.cwd(), 'server', 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-400-normal.woff');
    const fontsourceNotoBoldPath2 = path.join(process.cwd(), 'server', 'node_modules', '@fontsource', 'noto-sans-thai', 'files', 'noto-sans-thai-thai-700-normal.woff');

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
    } else {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      return { font, fontBold };
    }
  }

  /**
   * Generates authentic Tenant ID Card document PDF (สำเนาบัตรประจำตัวประชาชนผู้เช่า).
   */
  async generateIdCardPdf(data: {
    tenantName: string;
    citizenId: string;
    phone?: string | null;
    email?: string | null;
    roomNumber?: string | null;
    dormitoryName?: string | null;
    photoUrl?: string | null;
  }): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const { font, fontBold } = await this.loadFonts(pdfDoc);
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();

    const safeDormName = this.safeText(data.dormitoryName, 'หอพัก');
    const safeTenantName = this.safeText(data.tenantName, 'ไม่ระบุชื่อ');
    const safeCitizenId = this.safeText(data.citizenId, 'ไม่ระบุ');
    const safePhone = this.safeText(data.phone, 'ไม่ระบุ');
    const safeEmail = this.safeText(data.email, 'ไม่ระบุ');
    const safeRoomNumber = this.safeText(data.roomNumber, 'ไม่ระบุ');

    // Header
    page.drawText(safeDormName, {
      x: 50,
      y: height - 50,
      size: 16,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText('สำเนาบัตรประจำตัวประชาชนผู้เช่า (TENANT IDENTIFICATION DOCUMENT)', {
      x: 50,
      y: height - 72,
      size: 11,
      font: fontBold,
      color: rgb(0.2, 0.3, 0.6),
    });

    page.drawLine({
      start: { x: 50, y: height - 85 },
      end: { x: width - 50, y: height - 85 },
      thickness: 1.5,
      color: rgb(0.3, 0.4, 0.8),
    });

    // Outer card container
    const cardY = height - 360;
    const cardH = 250;
    page.drawRectangle({
      x: 50,
      y: cardY,
      width: width - 100,
      height: cardH,
      borderColor: rgb(0.75, 0.8, 0.9),
      borderWidth: 1,
      color: rgb(0.97, 0.98, 1.0),
    });

    // ID Card Banner
    page.drawRectangle({
      x: 50,
      y: cardY + cardH - 35,
      width: width - 100,
      height: 35,
      color: rgb(0.2, 0.3, 0.6),
    });
    page.drawText('บัตรประจำตัวประชาชน / THAILAND NATIONAL ID CARD', {
      x: 65,
      y: cardY + cardH - 23,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // ID Card Details
    let curY = cardY + cardH - 60;
    page.drawText(`ชื่อ-นามสกุล:`, { x: 70, y: curY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(safeTenantName, { x: 180, y: curY, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    curY -= 25;

    page.drawText(`เลขประจำตัวประชาชน:`, { x: 70, y: curY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(safeCitizenId, { x: 180, y: curY, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    curY -= 25;

    page.drawText(`ห้องพักที่ทำสัญญา:`, { x: 70, y: curY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`ห้อง ${safeRoomNumber}`, { x: 180, y: curY, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    curY -= 25;

    page.drawText(`เบอร์โทรศัพท์:`, { x: 70, y: curY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(safePhone, { x: 180, y: curY, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    curY -= 25;

    page.drawText(`อีเมล:`, { x: 70, y: curY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(safeEmail, { x: 180, y: curY, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    curY -= 25;

    page.drawText(`สถานะเอกสาร:`, { x: 70, y: curY, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('ตรวจสอบและรับรองความถูกต้องในระบบ HorPlus แล้ว', {
      x: 180,
      y: curY,
      size: 9,
      font,
      color: rgb(0.1, 0.5, 0.2),
    });

    // Embed Photo if available
    if (data.photoUrl && data.photoUrl.startsWith('data:image/')) {
      try {
        const base64Data = data.photoUrl.split(',')[1];
        const imageBytes = Buffer.from(base64Data, 'base64');
        const img = data.photoUrl.includes('jpeg') || data.photoUrl.includes('jpg')
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);
        page.drawImage(img, {
          x: width - 180,
          y: cardY + 30,
          width: 100,
          height: 130,
        });
      } catch (err) {
        // Continue if photo embedding fails
      }
    }

    // Footer
    page.drawText(`เอกสารสำเนาประจำตัวผู้เช่าอย่างเป็นทางการ — ระบบบริหารจัดการหอพัก HorPlus — หน้า 1 จาก 1`, {
      x: 50,
      y: 25,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  private formatThaiDate(dateStr?: string | null): string {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const thMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      const day = d.getDate();
      const month = thMonths[d.getMonth()];
      const year = d.getFullYear() + 543;
      return `${day} ${month} ${year}`;
    } catch {
      return dateStr;
    }
  }

  private formatBaht(amount?: string | number | null): string {
    if (amount === undefined || amount === null || amount === '') return '0.00';
    const num = Number(amount);
    if (isNaN(num)) return String(amount);
    return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private calculateDurationMonths(startStr?: string, endStr?: string): number {
    if (!startStr || !endStr) return 1;
    try {
      const d1 = new Date(startStr);
      const d2 = new Date(endStr);
      let months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
      if (d2.getDate() >= d1.getDate() - 2) months += 1;
      return Math.max(1, months);
    } catch {
      return 1;
    }
  }

  private safeText(str?: string | null, fallback = ''): string {
    if (!str) return fallback;
    const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    return cleaned || fallback;
  }
}
