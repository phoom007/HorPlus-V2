/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Announcement } from '../../types';
import { getAnnouncements, saveAnnouncements, addAuditLog } from '../../data/mockData';

export const announcementRepository = {
  getAll: (): Announcement[] => {
    return getAnnouncements();
  },

  getById: (id: string): Announcement | undefined => {
    return getAnnouncements().find(a => a.id === id);
  },

  createAnnouncement: (
    data: Omit<Announcement, 'id' | 'createdAt'>,
    actorUserId = 'user-owner'
  ): { success: boolean; announcement?: Announcement; message?: string } => {
    const list = getAnnouncements();
    const newAnn: Announcement = {
      ...data,
      id: `ann-${Date.now()}`,
      createdAt: new Date().toISOString()
    };

    list.unshift(newAnn);
    saveAnnouncements(list);

    addAuditLog(actorUserId, 'ประกาศข่าวสารใหม่', `สร้างประกาศ: ${data.title}`, 'Announcement', newAnn.id);

    return { success: true, announcement: newAnn };
  },

  deleteAnnouncement: (id: string, actorUserId = 'user-owner'): { success: boolean; message?: string } => {
    const list = getAnnouncements();
    const idx = list.findIndex(a => a.id === id);
    if (idx !== -1) {
      const ann = list[idx];
      list.splice(idx, 1);
      saveAnnouncements(list);
      addAuditLog(actorUserId, 'ลบประกาศข่าวสาร', `ลบประกาศ: ${ann.title}`, 'Announcement', id);
      return { success: true };
    }
    return { success: false, message: 'ไม่พบประกาศ' };
  }
};
