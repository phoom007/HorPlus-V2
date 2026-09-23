import { describe, it, expect, afterAll } from 'vitest';
import {
  DocumentPdfService,
  escapeHtml,
  isValidSignatureDataUrl,
  AsyncPdfSemaphore,
  SharedChromiumManager,
  type ContractPdfData,
} from '../../services/document-pdf.service.js';

describe('Task 04: PDF Security and Performance (SEC-07 & PERF-01)', () => {
  afterAll(async () => {
    await DocumentPdfService.closeSharedBrowser();
  });

  describe('1. HTML Escaping Utility (escapeHtml)', () => {
    it('escapes standard HTML special characters (&, <, >, ", \')', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
      expect(escapeHtml("Tom & Jerry's 'Special' <Tag>")).toBe(
        'Tom &amp; Jerry&#39;s &#39;Special&#39; &lt;Tag&gt;'
      );
    });

    it('handles null, undefined, empty, and numeric values safely', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('', 'default')).toBe('');
      expect(escapeHtml(null, 'default')).toBe('default');
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(0)).toBe('0');
    });

    it('neutralizes injected attributes and javascript pseudo-protocols', () => {
      const malicious = '" onmouseover="alert(1)" data-x="';
      expect(escapeHtml(malicious)).not.toContain('"');
      expect(escapeHtml(malicious)).toBe('&quot; onmouseover=&quot;alert(1)&quot; data-x=&quot;');
    });
  });

  describe('2. Signature Data URL Validation (isValidSignatureDataUrl)', () => {
    const validBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    it('accepts valid base64 image data URLs (png, jpeg, jpg, webp)', () => {
      expect(isValidSignatureDataUrl(`data:image/png;base64,${validBase64}`)).toBe(true);
      expect(isValidSignatureDataUrl(`data:image/jpeg;base64,${validBase64}`)).toBe(true);
      expect(isValidSignatureDataUrl(`data:image/jpg;base64,${validBase64}`)).toBe(true);
      expect(isValidSignatureDataUrl(`data:image/webp;base64,${validBase64}`)).toBe(true);
    });

    it('strictly rejects SSRF targets (http, https, file, metadata)', () => {
      expect(isValidSignatureDataUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
      expect(isValidSignatureDataUrl('https://evil.com/leak-token')).toBe(false);
      expect(isValidSignatureDataUrl('file:///etc/passwd')).toBe(false);
      expect(isValidSignatureDataUrl('http://localhost:3000/api/v1/internal')).toBe(false);
    });

    it('rejects non-image or script payloads disguised as data URLs', () => {
      expect(isValidSignatureDataUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
      expect(isValidSignatureDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
      expect(isValidSignatureDataUrl('javascript:alert(1)')).toBe(false);
      expect(isValidSignatureDataUrl('')).toBe(false);
      expect(isValidSignatureDataUrl(null)).toBe(false);
      expect(isValidSignatureDataUrl(undefined)).toBe(false);
    });
  });

  describe('3. Template HTML Injection Protection (DocumentPdfService.generateContractHtml)', () => {
    const pdfService = new DocumentPdfService();

    const baseContractData: ContractPdfData = {
      contractNumber: 'CTR-2026-001',
      dormitoryName: 'หอพักสุขใจ',
      dormitoryAddress: '123 ถ.พหลโยธิน กรุงเทพฯ',
      ownerName: 'สมศักดิ์ มั่งมี',
      tenantName: 'สมชาย รักสงบ',
      tenantCitizenId: '1-1004-99999-99-1',
      tenantPhone: '081-234-5678',
      roomNumber: '101',
      rentBillingType: 'monthly',
      startDate: '2026-10-01',
      endDate: '2027-09-30',
      rentAmount: '4500.00',
      depositAmount: '9000.00',
      waterRate: '18.00',
      electricityRate: '7.00',
      commonFee: '200.00',
      billingDay: 25,
      dueDay: 5,
    };

    it('escapes malicious HTML injected into tenant name and dormitory name', () => {
      const xssData: ContractPdfData = {
        ...baseContractData,
        tenantName: '<script>alert("XSS")</script> สมชาย',
        dormitoryName: '<b style="color:red">หอพักปลอม</b>',
        dormitoryAddress: '<iframe src="file:///etc/passwd"></iframe>',
        roomNumber: '101"><script>hack()</script>',
        terms: '<img src=x onerror=alert("terms")>\nข้อตกลงปกติ',
        contractNumber: 'CTR"><script>alert(1)</script>',
      };

      const html = pdfService.generateContractHtml(xssData);

      // Verify no raw script or iframe tags exist in the generated HTML
      expect(html).not.toContain('<script>alert("XSS")</script>');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<img src=x onerror=');
      expect(html).not.toContain('<script>hack()</script>');
      expect(html).not.toContain('<script>alert(1)</script>');

      // Verify properly escaped entities exist
      expect(html).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;iframe src=&quot;file:///etc/passwd&quot;&gt;&lt;/iframe&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(&quot;terms&quot;)&gt;');
    });

    it('neutralizes SSRF by rendering fallback dotted line when signature URL is http/https', () => {
      const ssrfData: ContractPdfData = {
        ...baseContractData,
        tenantSignature: 'http://169.254.169.254/latest/meta-data/',
        ownerSignatureUrl: 'https://evil.com/attacker.png',
      };

      const html = pdfService.generateContractHtml(ssrfData);

      // Should NOT render <img> tags containing the evil URLs
      expect(html).not.toContain('http://169.254.169.254');
      expect(html).not.toContain('https://evil.com');

      // Should render fallback dotted line signature boxes
      expect(html).toContain('border-bottom: 1px dotted #94a3b8');
    });

    it('renders valid <img> tags when signatures are valid base64 data URLs', () => {
      const validBase64Sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const validSigData: ContractPdfData = {
        ...baseContractData,
        tenantSignature: validBase64Sig,
        ownerSignatureUrl: validBase64Sig,
      };

      const html = pdfService.generateContractHtml(validSigData);

      expect(html).toContain(`<img src="${validBase64Sig}" alt="ลายเซ็นผู้เช่า"`);
      expect(html).toContain(`<img src="${validBase64Sig}" alt="ลายเซ็นผู้ให้เช่า"`);
    });
  });

  describe('4. Concurrency Bounding & AsyncPdfSemaphore (PERF-01)', () => {
    it('bounds concurrent executions to the semaphore limit', async () => {
      const semaphore = new AsyncPdfSemaphore(2);
      let activeCount = 0;
      let peakCount = 0;

      const runWorker = async (delayMs: number) => {
        const release = await semaphore.acquire();
        activeCount++;
        if (activeCount > peakCount) peakCount = activeCount;

        await new Promise((r) => setTimeout(r, delayMs));

        activeCount--;
        release();
      };

      // Launch 5 simultaneous workers
      await Promise.all([
        runWorker(40),
        runWorker(40),
        runWorker(40),
        runWorker(40),
        runWorker(40),
      ]);

      expect(peakCount).toBeLessThanOrEqual(2);
      expect(semaphore.getActiveCount()).toBe(0);
      expect(semaphore.getQueueLength()).toBe(0);
    });

    it('rejects with timeout when queue exceeds timeout threshold', async () => {
      const semaphore = new AsyncPdfSemaphore(1);
      const release1 = await semaphore.acquire();

      // Second request acquires with tiny timeout
      await expect(semaphore.acquire(20)).rejects.toThrow(/PDF generation queue timeout/i);

      release1();
      expect(semaphore.getActiveCount()).toBe(0);
    });
  });

  describe('5. Shared Chromium Manager Lifecycle (PERF-01)', () => {
    it('provides a reusable singleton browser instance', async () => {
      const browser1 = await SharedChromiumManager.getBrowser();
      expect(browser1).toBeDefined();
      expect(browser1.isConnected()).toBe(true);

      const browser2 = await SharedChromiumManager.getBrowser();
      expect(browser2).toBe(browser1); // Same shared instance
      expect(SharedChromiumManager.isBrowserActive()).toBe(true);
    });

    it('gracefully closes the shared browser instance', async () => {
      await SharedChromiumManager.closeBrowser();
      expect(SharedChromiumManager.isBrowserActive()).toBe(false);
    });
  });

  describe('6. Real PDF Generation with Chromium (generateContractPdf)', () => {
    it('generates authentic A4 PDF buffer and respects contractual timestamps', async () => {
      const pdfService = new DocumentPdfService();
      const testData: ContractPdfData = {
        contractNumber: 'CTR-2026-TEST',
        dormitoryName: 'หอพักทดสอบความปลอดภัย',
        dormitoryAddress: '99/9 ถ.มิตรภาพ จ.ขอนแก่น',
        ownerName: 'อาจารย์สมศักดิ์',
        tenantName: 'คุณกิตติศักดิ์ <script>test</script>',
        tenantCitizenId: '1-1004-12345-67-8',
        tenantPhone: '089-111-2222',
        roomNumber: '305',
        floor: 3,
        rentBillingType: 'monthly',
        startDate: '2026-11-01',
        endDate: '2027-10-31',
        rentAmount: '5000.00',
        depositAmount: '10000.00',
        waterRate: '20.00',
        electricityRate: '8.00',
        commonFee: '300.00',
        billingDay: 28,
        dueDay: 5,
        createdAt: '2026-10-25T14:30:00.000Z',
      };

      const pdfBuffer = await pdfService.generateContractPdf(testData);

      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      // PDF specification magic header: %PDF-
      const magicHeader = pdfBuffer.subarray(0, 5).toString('ascii');
      expect(magicHeader).toBe('%PDF-');
    }, 30000);

    it('handles concurrent PDF requests without crashing or process explosion', async () => {
      const pdfService = new DocumentPdfService();
      const testData: ContractPdfData = {
        contractNumber: 'CTR-CONCURRENT',
        dormitoryName: 'หอพักคอนเคอเรนท์',
        ownerName: 'เจ้าของหอ',
        tenantName: 'ผู้เช่าทดสอบ',
        roomNumber: '201',
        rentBillingType: 'monthly',
        startDate: '2026-11-01',
        endDate: '2027-10-31',
        rentAmount: '4000.00',
        depositAmount: '8000.00',
        waterRate: '18.00',
        electricityRate: '7.00',
        commonFee: '0.00',
        billingDay: 25,
        dueDay: 5,
      };

      // Launch 3 simultaneous PDF renders
      const [pdf1, pdf2, pdf3] = await Promise.all([
        pdfService.generateContractPdf({ ...testData, contractNumber: 'CTR-C1' }),
        pdfService.generateContractPdf({ ...testData, contractNumber: 'CTR-C2' }),
        pdfService.generateContractPdf({ ...testData, contractNumber: 'CTR-C3' }),
      ]);

      expect(pdf1.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pdf2.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pdf3.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    }, 45000);
  });
});
