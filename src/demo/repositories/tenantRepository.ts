/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tenant } from '../../types';
import { getTenants, saveTenants, addAuditLog } from '../../data/mockData';

export const tenantRepository = {
  getAll: (): Tenant[] => {
    return getTenants();
  },

  getById: (id: string): Tenant | undefined => {
    return getTenants().find(t => t.id === id);
  },

  getByCitizenId: (citizenId: string): Tenant | undefined => {
    return getTenants().find(t => t.citizenId.trim() === citizenId.trim());
  },

  addTenant: (tenantData: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>, actorUserId = 'user-owner'): { success: boolean; tenant?: Tenant; message?: string } => {
    const newTenant: Tenant = {
      ...tenantData,
      id: `tenant-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      rentalHistory: tenantData.rentalHistory || [],
      coOccupants: tenantData.coOccupants || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tenants = getTenants();
    tenants.push(newTenant);
    saveTenants(tenants);

    addAuditLog(actorUserId, 'เพิ่มข้อมูลผู้เช่าใหม่', `เพิ่มผู้เช่าชื่อ ${newTenant.name} (${newTenant.phone})`, 'Tenant', newTenant.id);

    return { success: true, tenant: newTenant };
  },

  updateTenant: (tenant: Tenant, actorUserId = 'user-owner'): { success: boolean; tenant?: Tenant; message?: string } => {
    const tenants = getTenants();
    const idx = tenants.findIndex(t => t.id === tenant.id);
    if (idx === -1) {
      return { success: false, message: 'ไม่พบข้อมูลผู้เช่า' };
    }

    const updatedTenant: Tenant = {
      ...tenant,
      updatedAt: new Date().toISOString()
    };

    tenants[idx] = updatedTenant;
    saveTenants(tenants);

    addAuditLog(actorUserId, 'แก้ไขข้อมูลผู้เช่า', `แก้ไขข้อมูลผู้เช่า ${updatedTenant.name}`, 'Tenant', updatedTenant.id);

    return { success: true, tenant: updatedTenant };
  },

  associateRoom: (tenantId: string, roomId: string): boolean => {
    const tenants = getTenants();
    const tenant = tenants.find(t => t.id === tenantId);
    if (tenant) {
      if (!tenant.rentalHistory.includes(roomId)) {
        tenant.rentalHistory.unshift(roomId);
      }
      tenant.status = 'active';
      tenant.updatedAt = new Date().toISOString();
      saveTenants(tenants);
      return true;
    }
    return false;
  }
};
