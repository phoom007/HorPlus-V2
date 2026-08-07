/**
 * LINE Friend Directory Service
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { hashToken, encryptText } from '../utils/crypto-encryption.js';

export class LineFriendService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Upsert a LINE friend from a webhook event or interaction
   */
  async upsertFriendFromWebhook(
    dormitoryId: string,
    lineUserId: string,
    displayName: string,
    pictureUrl?: string,
    eventStatus: 'FOLLOWING' | 'UNFOLLOWED' = 'FOLLOWING'
  ) {
    const lineUserIdHash = hashToken(lineUserId);
    const lineUserIdEncrypted = encryptText(lineUserId);

    const existing = await this.prisma.dormitoryLineFriend.findUnique({
      where: {
        dormitory_line_friend_unique: {
          dormitoryId,
          lineUserIdHash
        }
      }
    });

    if (existing) {
      return await this.prisma.dormitoryLineFriend.update({
        where: { id: existing.id },
        data: {
          displayName: displayName || existing.displayName,
          pictureUrl: pictureUrl !== undefined ? pictureUrl : existing.pictureUrl,
          friendStatus: eventStatus,
          unfollowedAt: eventStatus === 'UNFOLLOWED' ? new Date() : null,
          lastSeenAt: new Date()
        }
      });
    }

    return await this.prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId,
        lineUserIdHash,
        lineUserIdEncrypted,
        displayName: displayName || 'LINE User',
        pictureUrl,
        friendStatus: eventStatus,
        followedAt: new Date(),
        lastSeenAt: new Date()
      }
    });
  }

  /**
   * List all LINE friends for a dormitory
   */
  async getFriendsByDormitory(dormitoryId: string) {
    return await this.prisma.dormitoryLineFriend.findMany({
      where: { dormitoryId },
      orderBy: { createdAt: 'desc' }
    });
  }
}
