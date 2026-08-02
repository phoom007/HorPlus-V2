/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HorPlusDataProvider } from './contracts';
import { ApiDataProvider } from './adapters/api';

const apiProvider = new ApiDataProvider();

export function getDataProvider(): HorPlusDataProvider {
  return apiProvider;
}

export * from './contracts';
export * from './dataMode';
export * from './httpClient';
export { ApiDataProvider } from './adapters/api';
