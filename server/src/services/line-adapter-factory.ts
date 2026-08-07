/**
 * LINE Platform Adapter Factory
 * Production/dev/staging always use HttpLinePlatformAdapter.
 * Tests must explicitly inject MockLinePlatformAdapter.
 * @license Apache-2.0
 */

import { LinePlatformAdapter, HttpLinePlatformAdapter } from './line-platform-adapter.js';

/**
 * Create the production LINE adapter.
 * This function MUST NOT be called in test files — inject MockLinePlatformAdapter instead.
 */
export function createLinePlatformAdapter(): LinePlatformAdapter {
  return new HttpLinePlatformAdapter();
}
