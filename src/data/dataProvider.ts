/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HorPlusDataProvider } from './contracts';
import { getDataMode } from './dataMode';
import { DemoDataProvider } from './adapters/demo';
import { ApiDataProvider } from './adapters/api';

const demoProvider = new DemoDataProvider();
const apiProvider = new ApiDataProvider();

export function getDataProvider(): HorPlusDataProvider {
  const mode = getDataMode();
  if (mode === 'api') {
    return apiProvider;
  }
  return demoProvider;
}

export * from './contracts';
export * from './dataMode';
export * from './httpClient';
export { DemoDataProvider } from './adapters/demo';
export { ApiDataProvider } from './adapters/api';
