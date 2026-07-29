/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MeterReading } from '../../types';
import { getStored, setStored, addAuditLog, getRooms } from '../../data/mockData';

const METERS_KEY = 'meter_readings';

export const meterRepository = {
  getAll: (): MeterReading[] => {
    return getStored<MeterReading[]>(METERS_KEY, []);
  },

  getByCycle: (cycleId: string): MeterReading[] => {
    return meterRepository.getAll().filter(m => m.cycleId === cycleId);
  },

  getByRoomAndCycle: (roomId: string, cycleId: string): MeterReading | undefined => {
    return meterRepository.getAll().find(m => m.roomId === roomId && m.cycleId === cycleId);
  },

  recordReading: (
    reading: Omit<MeterReading, 'id' | 'createdAt'>,
    actorUserId = 'user-owner'
  ): { success: boolean; reading?: MeterReading; message?: string } => {
    if (reading.waterCurrent < reading.waterPrevious) {
      return { success: false, message: 'เลขมิเตอร์น้ำปัจจุบันต้องไม่น้อยกว่าเลขอ่านครั้งก่อน' };
    }
    if (reading.electricCurrent < reading.electricPrevious) {
      return { success: false, message: 'เลขมิเตอร์ไฟฟ้าปัจจุบันต้องไม่น้อยกว่าเลขอ่านครั้งก่อน' };
    }

    const readings = meterRepository.getAll();
    const existingIdx = readings.findIndex(m => m.roomId === reading.roomId && m.cycleId === reading.cycleId);

    const newReading: MeterReading = {
      ...reading,
      id: existingIdx >= 0 ? readings[existingIdx].id : `meter-${reading.cycleId}-${reading.roomId}`,
      createdAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      readings[existingIdx] = newReading;
    } else {
      readings.unshift(newReading);
    }

    setStored(METERS_KEY, readings);

    const rooms = getRooms();
    const room = rooms.find(r => r.id === reading.roomId);
    const roomNum = room ? room.roomNumber : reading.roomId;

    addAuditLog(actorUserId, 'บันทึกมิเตอร์น้ำไฟ', `บันทึกมิเตอร์ห้อง ${roomNum} งวด ${reading.cycleId} (น้ำ ${reading.waterUnits} หน่วย, ไฟ ${reading.electricUnits} หน่วย)`, 'MeterReading', newReading.id);

    return { success: true, reading: newReading };
  }
};
