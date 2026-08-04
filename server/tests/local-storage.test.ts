import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageProvider } from '../src/services/local-storage.service.js';

describe('LocalStorageProvider Security and Path Traversal Tests', () => {
  let provider: LocalStorageProvider;

  beforeEach(() => {
    provider = new LocalStorageProvider();
  });

  it('rejects simple parent traversal attempts (../)', () => {
    expect(() => provider.resolveSafePath('../secret.txt')).toThrow(/PATH_TRAVERSAL_DETECTED/);
    expect(() => provider.resolveSafePath('payments/../../secret.txt')).toThrow(/PATH_TRAVERSAL_DETECTED/);
  });

  it('rejects nested traversal attempts (a/b/../../../etc/passwd)', () => {
    expect(() => provider.resolveSafePath('payments/dorm1/bill1/../../../../etc/passwd')).toThrow(/PATH_TRAVERSAL_DETECTED/);
    expect(() => provider.resolveSafePath('sub/dir/../../..')).toThrow(/PATH_TRAVERSAL_DETECTED/);
  });

  it('rejects absolute Windows paths (C:\\Windows\\system.ini, D:\\data)', () => {
    expect(() => provider.resolveSafePath('C:\\Windows\\system.ini')).toThrow(/ABSOLUTE_PATH_REJECTED/);
    expect(() => provider.resolveSafePath('D:/data/secret.key')).toThrow(/ABSOLUTE_PATH_REJECTED/);
    expect(() => provider.resolveSafePath('\\\\server\\share\\file.txt')).toThrow(/ABSOLUTE_PATH_REJECTED/);
  });

  it('rejects absolute Unix paths (/etc/passwd, /var/log)', () => {
    expect(() => provider.resolveSafePath('/etc/passwd')).toThrow(/ABSOLUTE_PATH_REJECTED/);
    expect(() => provider.resolveSafePath('/var/data/uploads/file.png')).toThrow(/ABSOLUTE_PATH_REJECTED/);
  });

  it('rejects URL-encoded traversal sequences (%2e%2e, %2f, %00)', () => {
    expect(() => provider.resolveSafePath('payments/%2e%2e/secret.txt')).toThrow(/PATH_TRAVERSAL_DETECTED/);
    expect(() => provider.resolveSafePath('payments%2f%2e%2e%2fetc/passwd')).toThrow(/PATH_TRAVERSAL_DETECTED/);
    expect(() => provider.resolveSafePath('payments/slip%00.jpg')).toThrow(/INVALID_OBJECT_KEY|PATH_TRAVERSAL_DETECTED/);
    expect(() => provider.resolveSafePath('payments/slip\0.jpg')).toThrow(/INVALID_OBJECT_KEY/);
  });

  it('accepts valid nested object keys and performs async file operations', async () => {
    const validKey = 'payments/dorm-100/bill-200/evidence-test.jpg';
    const safePath = provider.resolveSafePath(validKey);
    expect(safePath).toContain('payments');
    expect(safePath).toContain('evidence-test.jpg');

    const testBuffer = Buffer.from('TEST_PAYMENT_EVIDENCE_BUFFER');
    
    // Test saveFile
    await provider.saveFile(validKey, testBuffer);

    // Test fileExists
    const exists = await provider.fileExists(validKey);
    expect(exists).toBe(true);

    // Test getFile
    const readBuffer = await provider.getFile(validKey);
    expect(readBuffer.toString()).toBe('TEST_PAYMENT_EVIDENCE_BUFFER');

    // Test deleteFile
    await provider.deleteFile(validKey);
    const existsAfterDelete = await provider.fileExists(validKey);
    expect(existsAfterDelete).toBe(false);
  });
});
