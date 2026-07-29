/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MaintenanceRequest, MaintenanceStatus, MaintenanceUpdate } from '../../types';
import { getMaintenance, saveMaintenance, addAuditLog, addNotification, getTenants, getRooms } from '../../data/mockData';

export const maintenanceRepository = {
  getAll: (): MaintenanceRequest[] => {
    return getMaintenance();
  },

  getById: (id: string): MaintenanceRequest | undefined => {
    return getMaintenance().find(m => m.id === id);
  },

  getByTenantId: (tenantId: string): MaintenanceRequest[] => {
    return getMaintenance().filter(m => m.tenantId === tenantId);
  },

  createRequest: (
    data: Omit<MaintenanceRequest, 'id' | 'createdAt' | 'updatedAt' | 'updates'>,
    actorUserId = 'tenant-user'
  ): { success: boolean; request?: MaintenanceRequest; message?: string } => {
    const list = getMaintenance();
    const requestNumber = `REQ-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${String(list.length + 1).padStart(3, '0')}`;

    const newReq: MaintenanceRequest = {
      ...data,
      id: `maint-${Date.now()}`,
      requestNumber,
      status: 'submitted',
      updates: [
        {
          id: `up-${Date.now()}`,
          status: 'submitted',
          note: 'ยื่นคำขอแจ้งซ่อมเรียบร้อยแล้ว',
          updatedBy: 'ผู้เช่า',
          updatedAt: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.unshift(newReq);
    saveMaintenance(list);

    const rooms = getRooms();
    const room = rooms.find(r => r.id === data.roomId);
    const roomNum = room ? room.roomNumber : '-';

    addAuditLog(actorUserId, 'แจ้งซ่อมใหม่', `ผู้เช่าห้อง ${roomNum} แจ้งซ่อม: ${data.title}`, 'MaintenanceRequest', newReq.id);

    addNotification('user-owner', 'แจ้งซ่อมแซมใหม่', `ห้อง ${roomNum} แจ้งซ่อม: ${data.title} (ความเร่งด่วน: ${data.urgency})`, 'repair_new', newReq.id);

    return { success: true, request: newReq };
  },

  updateStatus: (
    requestId: string,
    status: MaintenanceStatus,
    note: string,
    actorUserId = 'user-owner',
    cost?: number,
    assignedTechnicianId?: string
  ): { success: boolean; message?: string } => {
    const list = getMaintenance();
    const idx = list.findIndex(m => m.id === requestId);
    if (idx === -1) {
      return { success: false, message: 'ไม่พบรายการแจ้งซ่อม' };
    }

    const req = list[idx];
    req.status = status;
    req.updatedAt = new Date().toISOString();
    if (cost !== undefined) req.cost = cost;
    if (assignedTechnicianId) req.assignedTechnicianId = assignedTechnicianId;

    if (!req.updates) req.updates = [];
    req.updates.push({
      id: `up-${Date.now()}`,
      status,
      note,
      updatedBy: actorUserId === 'user-tech' ? 'ช่างซ่อม' : 'เจ้าหน้าที่หอพัก',
      updatedAt: new Date().toISOString()
    });

    saveMaintenance(list);

    addAuditLog(actorUserId, 'อัปเดตสถานะการแจ้งซ่อม', `อัปเดตรายการ ${req.requestNumber || requestId} เป็น ${status}`, 'MaintenanceRequest', requestId);

    if (req.tenantId) {
      addNotification(
        req.tenantId,
        `อัปเดตงานแจ้งซ่อม (${req.title})`,
        `สถานะงานแจ้งซ่อมเปลี่ยนเป็น: ${status} (${note})`,
        'repair_update',
        requestId
      );
    }

    return { success: true };
  }
};
