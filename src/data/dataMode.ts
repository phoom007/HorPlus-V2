/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DataMode = 'api';

export function getDataMode(): DataMode {
  return 'api';
}

export function setDataMode(_mode: DataMode): void {
  // Production runtime authority is strictly API
}

export function getApiBaseUrl(): string {
  return (import.meta as any).env?.VITE_API_BASE_URL || '/api/v1';
}

export const DEMO_BASELINE_VERSION = 'task009-v1';
export const DEMO_BASELINE_NAME = 'HorPlus Demo Release Candidate';

