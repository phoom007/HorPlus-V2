/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DataMode = 'demo' | 'api';

let activeDataMode: DataMode =
  (typeof window !== 'undefined' && (window.localStorage?.getItem('horplus_data_mode') as DataMode)) ||
  ((import.meta as any).env?.VITE_DATA_MODE as DataMode) ||
  'api';

export function getDataMode(): DataMode {
  return activeDataMode;
}

export function setDataMode(mode: DataMode): void {
  activeDataMode = mode;
}

export function getApiBaseUrl(): string {
  return (import.meta as any).env?.VITE_API_BASE_URL || '/api/v1';
}

export const DEMO_BASELINE_VERSION = 'task009-v1';
export const DEMO_BASELINE_NAME = 'HorPlus Demo Release Candidate';
