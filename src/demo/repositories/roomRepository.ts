/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Room, RoomStatus } from '../../types';
import { getRooms, saveRooms, addAuditLog } from '../../data/mockData';

export const roomRepository = {
  getAll: (): Room[] => {
    return getRooms();
  },

  getById: (id: string): Room | undefined => {
    return getRooms().find(r => r.id === id);
  },

  getByNumber: (roomNumber: string): Room | undefined => {
    if (!roomNumber) return undefined;
    return getRooms().find(r => (r?.roomNumber || '').trim().toLowerCase() === roomNumber.trim().toLowerCase());
  },

  addRoom: (roomData: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>, actorUserId = 'user-owner'): { success: boolean; room?: Room; message?: string } => {
    const existing = roomRepository.getByNumber(roomData.roomNumber);
    if (existing) {
      return { success: false, message: `เลขห้อง ${roomData.roomNumber} มีอยู่ในระบบแล้ว` };
    }

    const newRoom: Room = {
      ...roomData,
      id: `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const rooms = getRooms();
    rooms.push(newRoom);
    saveRooms(rooms);

    addAuditLog(actorUserId, 'เพิ่มห้องพักใหม่', `เพิ่มห้องพักเลขที่ ${newRoom.roomNumber}`, 'Room', newRoom.id);

    return { success: true, room: newRoom };
  },

  updateRoom: (room: Room, actorUserId = 'user-owner'): { success: boolean; room?: Room; message?: string } => {
    const rooms = getRooms();
    const idx = rooms.findIndex(r => r.id === room.id);
    if (idx === -1) {
      return { success: false, message: 'ไม่พบห้องพักที่ต้องการแก้ไข' };
    }

    // Check duplicate room number
    const dup = rooms.find(r => r.id !== room.id && (r?.roomNumber || '').trim().toLowerCase() === (room?.roomNumber || '').trim().toLowerCase());
    if (dup) {
      return { success: false, message: `เลขห้อง ${room.roomNumber} มีอยู่ในระบบแล้ว` };
    }

    const updatedRoom: Room = {
      ...room,
      updatedAt: new Date().toISOString()
    };

    rooms[idx] = updatedRoom;
    saveRooms(rooms);

    addAuditLog(actorUserId, 'แก้ไขข้อมูลห้องพัก', `แก้ไขข้อมูลห้องพักเลขที่ ${updatedRoom.roomNumber}`, 'Room', updatedRoom.id);

    return { success: true, room: updatedRoom };
  },

  updateStatus: (roomId: string, status: RoomStatus, currentTenantId?: string, actorUserId = 'user-owner'): boolean => {
    const rooms = getRooms();
    const idx = rooms.findIndex(r => r.id === roomId);
    if (idx !== -1) {
      rooms[idx].status = status;
      rooms[idx].currentTenantId = currentTenantId ?? rooms[idx].currentTenantId;
      rooms[idx].updatedAt = new Date().toISOString();
      saveRooms(rooms);
      addAuditLog(actorUserId, 'เปลี่ยนสถานะห้องพัก', `เปลี่ยนสถานะห้อง ${rooms[idx].roomNumber} เป็น ${status}`, 'Room', roomId);
      return true;
    }
    return false;
  },

  deleteRoom: (roomId: string, actorUserId = 'user-owner'): { success: boolean; message: string } => {
    const rooms = getRooms();
    const idx = rooms.findIndex(r => r.id === roomId);
    if (idx === -1) {
      return { success: false, message: 'ไม่พบห้องพัก' };
    }

    const room = rooms[idx];
    if (room.status === 'occupied' && room.currentTenantId) {
      return { success: false, message: `ไม่สามารถลบห้อง ${room.roomNumber} ได้ เนื่องจากมีผู้เช่าพักอาศัยอยู่` };
    }

    rooms.splice(idx, 1);
    saveRooms(rooms);

    addAuditLog(actorUserId, 'ลบห้องพัก', `ลบห้องพักเลขที่ ${room.roomNumber}`, 'Room', roomId);

    return { success: true, message: `ลบห้อง ${room.roomNumber} เรียบร้อยแล้ว` };
  }
};
