/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Notification } from '../../types';
import { getNotifications, saveNotifications } from '../../data/mockData';

export const notificationRepository = {
  getAll: (): Notification[] => {
    return getNotifications();
  },

  getByUserId: (userId: string): Notification[] => {
    return getNotifications().filter(n => n.userId === userId || n.userId === 'user-owner' || n.userId === 'all');
  },

  getUnreadCount: (userId: string): number => {
    return notificationRepository.getByUserId(userId).filter(n => !n.isRead).length;
  },

  addNotification: (
    userId: string,
    title: string,
    message: string,
    type: Notification['type'],
    relatedEntityId?: string
  ): Notification => {
    const notes = getNotifications();
    const newNote: Notification = {
      id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId,
      title,
      message,
      type,
      relatedEntityId,
      isRead: false,
      createdAt: new Date().toISOString()
    };

    notes.unshift(newNote);
    saveNotifications(notes);
    return newNote;
  },

  markAsRead: (notificationId: string): void => {
    const notes = getNotifications();
    const note = notes.find(n => n.id === notificationId);
    if (note) {
      note.isRead = true;
      saveNotifications(notes);
    }
  },

  markAllAsRead: (userId: string): void => {
    const notes = getNotifications();
    notes.forEach(n => {
      if (n.userId === userId || n.userId === 'user-owner' || n.userId === 'all') {
        n.isRead = true;
      }
    });
    saveNotifications(notes);
  }
};
