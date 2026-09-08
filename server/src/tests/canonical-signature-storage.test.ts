import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  findProjectRoot,
  getCanonicalSignatureStorageDir,
  resolveSafeSignaturePath,
  LocalOwnerSignatureStorage,
} from '../services/signature-storage.service.js';
import { AppError } from '../types/index.js';

describe('Canonical Signature Storage & Authority Security', () => {
  const originalCwd = process.cwd();
  const testTmpDir = path.join(os.tmpdir(), `horplus-sig-test-${Date.now()}`);

  beforeEach(() => {
    if (!fs.existsSync(testTmpDir)) {
      fs.mkdirSync(testTmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  describe('cwd-independence (Concurrency-Safe)', () => {
    it('pure resolver always locates canonical project root across directory structures', () => {
      const rootDir = findProjectRoot();
      const expectedCanonical = path.resolve(rootDir, 'storage', 'signatures');

      expect(getCanonicalSignatureStorageDir()).toBe(expectedCanonical);
      expect(findProjectRoot(rootDir)).toBe(rootDir);
      expect(findProjectRoot(path.join(rootDir, 'server'))).toBe(rootDir);
      expect(findProjectRoot(path.join(rootDir, 'server', 'src'))).toBe(rootDir);
      expect(findProjectRoot(path.join(rootDir, 'src'))).toBe(rootDir);
    });

    it('isolated child process confirms cwd-independence without mutating runner cwd', () => {
      const rootDir = findProjectRoot();
      const expectedCanonical = path.resolve(rootDir, 'storage', 'signatures').replace(/\\/g, '\\\\');
      const serviceFile = path.resolve(rootDir, 'server/dist/services/signature-storage.service.js').replace(/\\/g, '\\\\');
      const script = `
        const path = require('path');
        const { getCanonicalSignatureStorageDir, LocalOwnerSignatureStorage } = require('${serviceFile}');
        const expected = '${expectedCanonical}';
        const actual1 = getCanonicalSignatureStorageDir();
        if (actual1 !== expected) {
          console.error('Mismatch in getCanonicalSignatureStorageDir:', actual1, 'vs', expected);
          process.exit(1);
        }
        const storage = new LocalOwnerSignatureStorage();
        if (storage.getStorageDir() !== expected) {
          console.error('Mismatch in LocalOwnerSignatureStorage:', storage.getStorageDir(), 'vs', expected);
          process.exit(2);
        }
        process.exit(0);
      `;
      // Run from different directories in separate child processes
      const { execSync } = require('child_process');
      execSync(`node -e "${script.replace(/\n/g, ' ')}"`, { cwd: path.join(rootDir, 'server') });
      execSync(`node -e "${script.replace(/\n/g, ' ')}"`, { cwd: testTmpDir });
    });
  });

  describe('Path Traversal & Safe Path Resolution', () => {
    const baseDir = path.join(testTmpDir, 'storage');

    it('allows valid object keys and resolves to safe path', () => {
      const resolved = resolveSafeSignaturePath(baseDir, 'signatures/v1-test.png');
      expect(resolved).toBe(path.resolve(baseDir, 'v1-test.png'));
    });

    it('rejects relative path traversal with ..', () => {
      expect(() => resolveSafeSignaturePath(baseDir, '../secret.png')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, '../../etc/passwd')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, 'dormitories/../../evil.png')).toThrow(AppError);
    });

    it('rejects URL encoded path traversal (%2e%2e)', () => {
      expect(() => resolveSafeSignaturePath(baseDir, '%2e%2e/test.png')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, 'dormitories/%2e%2e/test.png')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, '%2f%2e%2e/test.png')).toThrow(AppError);
    });

    it('rejects null byte injection (%00 and \\0)', () => {
      expect(() => resolveSafeSignaturePath(baseDir, 'test.png\0.evil')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, 'test.png%00.evil')).toThrow(AppError);
    });

    it('rejects absolute paths and drive letters', () => {
      expect(() => resolveSafeSignaturePath(baseDir, '/etc/passwd')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, 'C:\\Windows\\win.ini')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, '\\\\server\\share\\evil.png')).toThrow(AppError);
    });

    it('rejects empty or non-string keys', () => {
      expect(() => resolveSafeSignaturePath(baseDir, '')).toThrow(AppError);
      expect(() => resolveSafeSignaturePath(baseDir, null as any)).toThrow(AppError);
    });
  });

  describe('Single Binary Authority & No Dual Mirroring', () => {
    it('saves strictly to canonical directory without writing to any mirror directory', async () => {
      const customStorageDir = path.join(testTmpDir, 'canonical');
      const storage = new LocalOwnerSignatureStorage(customStorageDir);

      const fakeBuffer = Buffer.from('FAKE_PNG_BINARY');
      const objectKey = 'dormitories/dorm-101/signatures/v1-sample.png';

      await storage.save(objectKey, fakeBuffer);

      // Must exist in canonical storage
      const savedPath = path.join(customStorageDir, 'v1-sample.png');
      expect(fs.existsSync(savedPath)).toBe(true);

      // Verify NO mirror directory exists anywhere in testTmpDir
      const mirrorA = path.resolve(customStorageDir, '../../../storage/signatures');
      const mirrorB = path.resolve(customStorageDir, '../../server/storage/signatures');
      expect(fs.existsSync(mirrorA)).toBe(false);
      expect(fs.existsSync(mirrorB)).toBe(false);

      // Deleting removes the file
      await storage.delete(objectKey);
      expect(fs.existsSync(savedPath)).toBe(false);
    });
  });
});
