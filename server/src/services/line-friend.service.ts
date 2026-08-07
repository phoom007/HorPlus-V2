/**
 * LINE Friend Directory Service (Sanitized DTOs & Encrypted Identity Storage)
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { hashToken, encryptText, decryptText } from '../utils/crypto-encryption.js';

export interface LineFriendDTO {
  id: string;
  displayName: string;
  pictureUrl: string | null;
  friendStatus: string;
  followedAt: Date;
  unfollowedAt: Date | null;
  lastSeenAt: Date;
}

export class LineFriendService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Upsert a LINE friend from a webhook event or interaction
   */
  async upsertFriendFromWebhook(
    dormitoryId: string,
    lineUserId: string,
    displayName: string,
    pictureUrl?: string | null,
    eventStatus: 'FOLLOWING' | 'UNFOLLOWED' = 'FOLLOWING'
  ): Promise<LineFriendDTO> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const lineUserIdHash = hashToken(lineUserId);
      const lineUserIdEncrypted = encryptText(lineUserId);

      const existing = await tx.dormitoryLineFriend.findUnique({
        where: {
          dormitory_line_friend_unique: {
            dormitoryId,
            lineUserIdHash
          }
        }
      });

      let record;
      if (existing) {
        record = await tx.dormitoryLineFriend.update({
          where: { id: existing.id },
          data: {
            displayName: displayName || existing.displayName,
            pictureUrl: pictureUrl !== undefined ? pictureUrl : existing.pictureUrl,
            friendStatus: eventStatus,
            unfollowedAt: eventStatus === 'UNFOLLOWED' ? new Date() : null,
            lastSeenAt: new Date()
          }
        });
      } else {
        record = await tx.dormitoryLineFriend.create({
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

      return this.toDTO(record);
    });
  }

  /**
   * Get decrypted actual LINE userId internally for server-side push adapter
   */
  async getActualLineUserId(lineFriendId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT line_user_id_encrypted FROM public.resolve_access_grant_friend(${lineFriendId}::uuid)
    `;
    if (!rows || rows.length === 0 || !rows[0].line_user_id_encrypted) return null;
    try {
      return decryptText(rows[0].line_user_id_encrypted);
    } catch {
      return null;
    }
  }

  /**
   * List all LINE friends for a dormitory (Sanitized DTOs - NO raw hashes/encrypted blobs)
   */
  async getFriendsByDormitory(dormitoryId: string): Promise<LineFriendDTO[]> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      const friends = await tx.dormitoryLineFriend.findMany({
        where: { dormitoryId },
        orderBy: { createdAt: 'desc' }
      });
      return friends.map((f) => this.toDTO(f));
    });
  }

  private toDTO(record: any): LineFriendDTO {
    return {
      id: record.id,
      displayName: record.displayName,
      pictureUrl: record.pictureUrl,
      friendStatus: record.friendStatus,
      followedAt: record.followedAt,
      unfollowedAt: record.unfollowedAt,
      lastSeenAt: record.lastSeenAt
    };
  }
}
