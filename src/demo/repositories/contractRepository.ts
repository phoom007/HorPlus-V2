/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Contract, ContractStatus, BLOCKING_CONTRACT_STATUSES } from '../../types';
import { getContracts, saveContracts, addAuditLog, getRooms, saveRooms, getTenants, saveTenants } from '../../data/mockData';

export const contractRepository = {
  getAll: (): Contract[] => {
    return getContracts();
  },

  getById: (id: string): Contract | undefined => {
    return getContracts().find(c => c.id === id);
  },

  getByRoomId: (roomId: string): Contract[] => {
    return getContracts().filter(c => c.roomId === roomId);
  },

  getActiveContractForRoom: (roomId: string): Contract | undefined => {
    return getContracts().find(c => c.roomId === roomId && BLOCKING_CONTRACT_STATUSES.includes(c.status));
  },

  checkOverlap: (roomId: string, startDate: string, endDate: string, excludeContractId?: string): boolean => {
    const contracts = getContracts().filter(c => c.roomId === roomId && c.id !== excludeContractId && c.status !== 'terminated' && c.status !== 'expired');
    const startA = new Date(startDate).getTime();
    const endA = new Date(endDate).getTime();

    for (const c of contracts) {
      const startB = new Date(c.startDate).getTime();
      const endB = new Date(c.endDate).getTime();
      if (startA < endB && endA > startB) {
        return true; // Overlap detected!
      }
    }
    return false;
  },

  addContract: (contractData: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'>, actorUserId = 'user-owner'): { success: boolean; contract?: Contract; message?: string } => {
    if (new Date(contractData.endDate) <= new Date(contractData.startDate)) {
      return { success: false, message: 'วันสิ้นสุดสัญญาต้องอยู่หลังวันเริ่มต้นสัญญา' };
    }

    if (contractRepository.checkOverlap(contractData.roomId, contractData.startDate, contractData.endDate)) {
      return { success: false, message: 'พบช่วงเวลาสัญญาซ้อนทับกับสัญญาเดิมของห้องนี้' };
    }

    const newContract: Contract = {
      ...contractData,
      id: `contract-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const contracts = getContracts();
    contracts.unshift(newContract);
    saveContracts(contracts);

    // Sync room occupied status & current tenant
    if (['active', 'pending_signature', 'expiring_soon'].includes(newContract.status)) {
      const rooms = getRooms();
      const room = rooms.find(r => r.id === newContract.roomId);
      if (room) {
        room.status = 'occupied';
        room.currentTenantId = newContract.tenantId;
        room.updatedAt = new Date().toISOString();
        saveRooms(rooms);
      }

      const tenants = getTenants();
      const tenant = tenants.find(t => t.id === newContract.tenantId);
      if (tenant) {
        if (!tenant.rentalHistory.includes(newContract.roomId)) {
          tenant.rentalHistory.unshift(newContract.roomId);
        }
        tenant.status = 'active';
        tenant.updatedAt = new Date().toISOString();
        saveTenants(tenants);
      }
    }

    addAuditLog(actorUserId, 'สร้างสัญญาเช่าใหม่', `สร้างสัญญาเลขที่ ${newContract.contractNumber}`, 'Contract', newContract.id);

    return { success: true, contract: newContract };
  },

  updateContractStatus: (contractId: string, status: ContractStatus, actorUserId = 'user-owner'): { success: boolean; message?: string } => {
    const contracts = getContracts();
    const idx = contracts.findIndex(c => c.id === contractId);
    if (idx === -1) {
      return { success: false, message: 'ไม่พบสัญญาเช่า' };
    }

    const contract = contracts[idx];
    contract.status = status;
    contract.updatedAt = new Date().toISOString();
    saveContracts(contracts);

    // If terminated or expired, update room and tenant state if no other active contract
    if (['terminated', 'expired'].includes(status)) {
      const activeOther = contracts.find(c => c.roomId === contract.roomId && c.id !== contractId && BLOCKING_CONTRACT_STATUSES.includes(c.status));
      if (!activeOther) {
        const rooms = getRooms();
        const room = rooms.find(r => r.id === contract.roomId);
        if (room) {
          room.status = 'vacant';
          room.currentTenantId = undefined;
          room.updatedAt = new Date().toISOString();
          saveRooms(rooms);
        }
      }
    }

    addAuditLog(actorUserId, 'เปลี่ยนสถานะสัญญาเช่า', `ปรับสถานะสัญญาเลขที่ ${contract.contractNumber} เป็น ${status}`, 'Contract', contractId);

    return { success: true };
  },

  extendContract: (contractId: string, extensionMonths: number, actorUserId = 'user-owner'): { success: boolean; contract?: Contract; message?: string } => {
    const contracts = getContracts();
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) {
      return { success: false, message: 'ไม่พบสัญญาเช่า' };
    }

    const currentEnd = new Date(contract.endDate);
    currentEnd.setMonth(currentEnd.getMonth() + extensionMonths);
    const newEndDate = currentEnd.toISOString().split('T')[0];

    contract.endDate = newEndDate;
    contract.durationMonths += extensionMonths;
    contract.status = 'active';
    contract.updatedAt = new Date().toISOString();

    saveContracts(contracts);

    addAuditLog(actorUserId, 'ต่ออายุสัญญาเช่า', `ต่ออายุสัญญาเลขที่ ${contract.contractNumber} เพิ่ม ${extensionMonths} เดือน ถึง ${newEndDate}`, 'Contract', contractId);

    return { success: true, contract };
  }
};
