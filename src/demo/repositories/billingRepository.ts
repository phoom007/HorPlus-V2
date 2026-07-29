/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bill, BillItem, BillStatus, calculateRoomRentForCycle } from '../../types';
import { getBills, saveBills, getRooms, getContracts, addAuditLog, addNotification, getDormitory, getDormitoryRatesForCycle, getTenants } from '../../data/mockData';
import { meterRepository } from './meterRepository';

export const billingRepository = {
  getAll: (): Bill[] => {
    return getBills();
  },

  getById: (id: string): Bill | undefined => {
    return getBills().find(b => b.id === id);
  },

  getByTenantId: (tenantId: string): Bill[] => {
    return getBills().filter(b => b.tenantId === tenantId);
  },

  getByCycle: (cycleId: string): Bill[] => {
    return getBills().filter(b => b.cycleId === cycleId);
  },

  getByRoomAndCycle: (roomId: string, cycleId: string): Bill | undefined => {
    return getBills().find(b => b.roomId === roomId && b.cycleId === cycleId && b.status !== 'cancelled');
  },

  generateBillForRoom: (
    roomId: string,
    cycleId: string,
    actorUserId = 'user-owner'
  ): { success: boolean; bill?: Bill; message?: string } => {
    const existing = billingRepository.getByRoomAndCycle(roomId, cycleId);
    if (existing) {
      return { success: false, message: `มีบิลของห้องนี้สำหรับงวด ${cycleId} อยู่แล้วในระบบ` };
    }

    const rooms = getRooms();
    const room = rooms.find(r => r.id === roomId);
    if (!room || room.status !== 'occupied' || !room.currentTenantId) {
      return { success: false, message: 'ไม่พบผู้เช่าในห้องพักนี้' };
    }

    const contracts = getContracts();
    const activeContract = contracts.find(c => c.roomId === roomId && c.tenantId === room.currentTenantId && ['active', 'expiring_soon', 'waiting_extension'].includes(c.status));
    
    if (!activeContract) {
      return { success: false, message: 'ไม่พบสัญญาเช่าที่ใช้งานอยู่สำหรับห้องนี้' };
    }

    const dorm = getDormitory();
    const meter = meterRepository.getByRoomAndCycle(roomId, cycleId);

    const rentInfo = calculateRoomRentForCycle(room, cycleId, activeContract);
    const items: BillItem[] = [
      {
        id: `b-${cycleId}-${roomId}-rent`,
        description: rentInfo.description,
        amount: rentInfo.amount,
        category: 'rent'
      }
    ];

    if (meter) {
      const waterAmt = meter.waterUnits * dorm.waterUnitRate + (dorm.waterServiceFee || 0);
      const electricAmt = meter.electricUnits * dorm.electricUnitRate + (dorm.electricServiceFee || 0);

      items.push({
        id: `b-${cycleId}-${roomId}-water`,
        description: `ค่าน้ำ (${meter.waterUnits} หน่วย)`,
        amount: waterAmt,
        category: 'water'
      });

      items.push({
        id: `b-${cycleId}-${roomId}-elec`,
        description: `ค่าไฟ (${meter.electricUnits} หน่วย)`,
        amount: electricAmt,
        category: 'electricity'
      });
    }

    const rates = getDormitoryRatesForCycle(dorm, cycleId);

    if (rates.parkingFeeMode !== 'free') {
      let parkingFeeAmt = 0;
      let parkingDesc = 'ค่าที่จอดรถ';

      const tenants = getTenants();
      const tenant = tenants.find(t => t.id === activeContract.tenantId);

      if (rates.parkingFeeMode === 'vehicle') {
        if (tenant && tenant.vehicle && tenant.vehicle.type && tenant.vehicle.type !== 'none') {
          parkingFeeAmt = rates.parkingFee || room.parkingFee || 100;
          const vType = tenant.vehicle.type === 'car' ? 'รถยนต์' : tenant.vehicle.type === 'motorcycle' ? 'รถจักรยานยนต์' : 'ยานพาหนะ';
          parkingDesc = `ค่าที่จอดรถ${vType}${tenant.vehicle.licensePlate ? ` (${tenant.vehicle.licensePlate})` : ''}`;
        }
      } else {
        parkingFeeAmt = rates.parkingFee || room.parkingFee || 100;
      }

      if (parkingFeeAmt > 0) {
        items.push({
          id: `b-${cycleId}-${roomId}-parking`,
          description: parkingDesc,
          amount: parkingFeeAmt,
          category: 'parking'
        });
      }
    }

    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);

    // Calculate due date (5th of next month)
    const [yearStr, monthStr] = cycleId.split('-');
    const y = parseInt(yearStr);
    const m = parseInt(monthStr);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const dueDate = `${nextY}-${String(nextM).padStart(2, '0')}-05`;

    const newBill: Bill = {
      id: `bill-${cycleId}-${roomId}`,
      billNumber: `BILL-${cycleId.replace('-', '')}-${room.roomNumber}`,
      cycleId,
      roomId,
      tenantId: activeContract.tenantId,
      items,
      totalAmount,
      dueDate,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const bills = getBills();
    bills.unshift(newBill);
    saveBills(bills);

    addAuditLog(actorUserId, 'ออกบิลค่าน้ำไฟประจำเดือน', `ออกบิลเลขที่ ${newBill.billNumber} ห้อง ${room.roomNumber} ยอดเงิน ${totalAmount.toLocaleString()} บาท`, 'Bill', newBill.id);

    addNotification(
      activeContract.tenantId,
      `ใบแจ้งหนี้ประจำเดือน ${cycleId}`,
      `ใบแจ้งหนี้ห้อง ${room.roomNumber} ประจำงวด ${cycleId} ออกเรียบร้อยแล้ว ยอดชำระ ${totalAmount.toLocaleString()} บาท กำหนดชำระภายใน ${dueDate}`,
      'bill_new',
      newBill.id
    );

    return { success: true, bill: newBill };
  },

  updateBillStatus: (billId: string, status: BillStatus, actorUserId = 'user-owner', extra?: { slipImage?: string; paymentMethod?: 'promptpay' | 'cash'; rejectReason?: string; paidAt?: string }): { success: boolean; message?: string } => {
    const bills = getBills();
    const idx = bills.findIndex(b => b.id === billId);
    if (idx === -1) {
      return { success: false, message: 'ไม่พบใบแจ้งหนี้' };
    }

    const bill = bills[idx];
    bill.status = status;
    bill.updatedAt = new Date().toISOString();

    if (extra?.slipImage) bill.slipImage = extra.slipImage;
    if (extra?.paymentMethod) bill.paymentMethod = extra.paymentMethod;
    if (extra?.rejectReason) bill.rejectReason = extra.rejectReason;
    if (extra?.paidAt) bill.paidAt = extra.paidAt;

    saveBills(bills);

    addAuditLog(actorUserId, 'ปรับสถานะใบแจ้งหนี้', `ปรับสถานะบิล ${bill.billNumber} เป็น ${status}`, 'Bill', billId);

    return { success: true };
  },

  cancelBill: (billId: string, reason: string, actorUserId = 'user-owner'): { success: boolean; message?: string } => {
    return billingRepository.updateBillStatus(billId, 'cancelled', actorUserId, { rejectReason: reason });
  }
};
