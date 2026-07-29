/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuditLog } from '../../types';
import { getAuditLogs, saveAuditLogs, addAuditLog } from '../../data/mockData';

export const auditRepository = {
  getAll: (): AuditLog[] => {
    return getAuditLogs();
  },

  addLog: (userId: string, action: string, details: string, entityType: string, entityId: string): void => {
    addAuditLog(userId, action, details, entityType, entityId);
  },

  filter: (entityType?: string, actionKeyword?: string): AuditLog[] => {
    let logs = getAuditLogs();
    if (entityType) {
      logs = logs.filter(l => l.entityType === entityType);
    }
    if (actionKeyword) {
      logs = logs.filter(l => l.action.includes(actionKeyword) || l.details.includes(actionKeyword));
    }
    return logs;
  }
};
