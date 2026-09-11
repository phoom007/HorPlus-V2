/**
 * Centralized Canonical Storage Path Resolution Utility
 * 
 * Provides deterministic, cwd-independent storage path resolution and
 * safe path traversal validation for local development/test environments.
 * 
 * Invariant: Storage paths resolve strictly against the canonical project root
 * regardless of process.cwd(), ensuring production portability and zero mirroring.
 * 
 * @license Apache-2.0
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AppError } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedProjectRoot: string | null = null;

/**
 * Deterministically locates the canonical project root.
 * Walks up the filesystem hierarchy from the caller's directory (or __dirname)
 * searching for the root project markers (package.json + server/ directory + src/ directory).
 */
export function findProjectRoot(startDir: string = __dirname): string {
  if (cachedProjectRoot && !startDir) {
    return cachedProjectRoot;
  }

  let curr = path.resolve(startDir);
  while (curr && curr !== path.dirname(curr)) {
    if (
      fs.existsSync(path.join(curr, 'package.json')) &&
      fs.existsSync(path.join(curr, 'server')) &&
      fs.existsSync(path.join(curr, 'src'))
    ) {
      cachedProjectRoot = curr;
      return curr;
    }
    curr = path.dirname(curr);
  }

  // Secondary fallback: walk up to the top-level package.json that is not horplus-backend
  curr = path.resolve(startDir);
  while (curr && curr !== path.dirname(curr)) {
    const pkgPath = path.join(curr, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name !== 'horplus-backend') {
          cachedProjectRoot = curr;
          return curr;
        }
      } catch {}
    }
    curr = path.dirname(curr);
  }

  // Ultimate fallback
  const fallback = path.resolve(startDir, '../../..');
  cachedProjectRoot = fallback;
  return fallback;
}

/**
 * Returns the cached or computed canonical project root directory.
 */
export function getCanonicalProjectRoot(): string {
  return findProjectRoot();
}

/**
 * Returns the canonical storage root directory for signatures.
 * Adheres strictly to cwd-independence and respects optional SIGNATURES_STORAGE_DIR.
 * Environment overrides must be absolute or resolved against the canonical project root,
 * never against process.cwd().
 */
export function getCanonicalSignaturesDir(): string {
  const root = getCanonicalProjectRoot();
  const envOverride = process.env.SIGNATURES_STORAGE_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return path.isAbsolute(envOverride) ? path.resolve(envOverride) : path.resolve(root, envOverride);
  }
  return path.join(root, 'storage', 'signatures');
}

/**
 * Returns the canonical storage root directory for dormitory logos.
 * Adheres strictly to cwd-independence and respects optional LOGOS_STORAGE_DIR.
 * Environment overrides must be absolute or resolved against the canonical project root,
 * never against process.cwd().
 */
export function getCanonicalLogosDir(): string {
  const root = getCanonicalProjectRoot();
  const envOverride = process.env.LOGOS_STORAGE_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return path.isAbsolute(envOverride) ? path.resolve(envOverride) : path.resolve(root, envOverride);
  }
  return path.join(root, 'storage', 'logos');
}

/**
 * Safely resolves an objectKey to a local filesystem path strictly inside baseDir.
 * 
 * Enforces:
 * - Rejection of null bytes and URL-encoded null bytes (%00)
 * - Rejection of traversal tokens ('..' and '%2e%2e')
 * - Rejection of absolute paths (Unix, Windows drive letters, UNC paths)
 * - Containment within baseDir (prevents jailbreaks)
 * - Physical layout preservation: flat basename mapping by default,
 *   with backward-compatible support for existing nested files.
 */
export function resolveSafeLocalPath(baseDir: string, objectKey: string): string {
  if (!objectKey || typeof objectKey !== 'string') {
    throw new AppError('Object key must be a non-empty string', 400, 'INVALID_OBJECT_KEY');
  }

  // Reject null bytes
  if (objectKey.includes('\0')) {
    throw new AppError('Object key contains null bytes', 400, 'PATH_TRAVERSAL_DETECTED');
  }

  // Reject encoded traversal or URL encoded null bytes
  const lowerKey = objectKey.toLowerCase();
  let decodedKey = objectKey;
  try {
    decodedKey = decodeURIComponent(objectKey);
  } catch {
    throw new AppError('Invalid URL encoding in object key', 400, 'PATH_TRAVERSAL_DETECTED');
  }

  if (
    lowerKey.includes('%00') ||
    lowerKey.includes('%2e%2e') ||
    lowerKey.includes('%2f') ||
    lowerKey.includes('%5c') ||
    decodedKey.includes('..') ||
    decodedKey.includes('\0')
  ) {
    throw new AppError('Encoded traversal sequence rejected', 400, 'PATH_TRAVERSAL_DETECTED');
  }

  // Reject absolute paths (Unix, Windows drive letter, UNC)
  if (
    path.isAbsolute(objectKey) ||
    objectKey.startsWith('/') ||
    objectKey.startsWith('\\') ||
    /^[a-zA-Z]:/.test(objectKey) ||
    objectKey.startsWith('\\\\')
  ) {
    throw new AppError('Absolute paths are not allowed', 400, 'INVALID_SIGNATURE_KEY');
  }

  const canonicalBase = path.resolve(baseDir);

  // Check if a nested file exists (backward-compatibility)
  const nestedPath = path.resolve(canonicalBase, ...objectKey.split('/'));
  const relNested = path.relative(canonicalBase, nestedPath);
  if (relNested.startsWith('..') || path.isAbsolute(relNested)) {
    throw new AppError('Path traversal detected', 400, 'PATH_TRAVERSAL_DETECTED');
  }
  if (fs.existsSync(nestedPath) && !fs.statSync(nestedPath).isDirectory()) {
    return nestedPath;
  }

  // Default: flat basename mapping preserving physical layout
  const flatPath = path.resolve(canonicalBase, path.basename(objectKey));
  const relFlat = path.relative(canonicalBase, flatPath);
  if (relFlat.startsWith('..') || path.isAbsolute(relFlat) || flatPath === canonicalBase) {
    throw new AppError('Path traversal detected', 400, 'PATH_TRAVERSAL_DETECTED');
  }

  return flatPath;
}
