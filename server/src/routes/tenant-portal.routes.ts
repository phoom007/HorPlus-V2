import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../db/prisma.js';
import { roomBillingStateService } from '../services/room-billing-state.service.js';
import { AuditService } from '../services/audit.service.js';
import { MaintenanceService } from '../services/maintenance.service.js';
import { AnnouncementService } from '../services/announcement.service.js';
import { DocumentPdfService } from '../services/document-pdf.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { generatePromptPayPayload, maskPromptPayDisplay, formatPromptPayDisplay, generatePromptPayQrSvg } from '../services/promptpay-payload.service.js';
import { billingOrchestrationService } from '../services/billing-orchestration.service.js';
import { CreateCoOccupantSchema } from '../schemas/property-tenant-contract.schemas.js';
import { isBillVisibleToTenant, getTenantRentCutoffDate } from '../utils/tenant-visibility.util.js';
import { LocalStorageProvider } from '../services/local-storage.service.js';
import { SignatureStorageService } from '../services/signature-storage.service.js';

type TenantContextResult = {
  error?: undefined;
  tenant: any;
  dormitoryId: string;
  contract?: any;
  roomId?: string;
  isCandidate?: boolean;
} | {
  error: { code: string; message: string; statusCode: number };
  tenant?: undefined;
  dormitoryId?: undefined;
  contract?: undefined;
  roomId?: undefined;
  isCandidate?: undefined;
};

async function resolveTenantContext(req: Request): Promise<TenantContextResult> {
  const prisma = getPrismaClient();
  const userId = req.auth?.userId;
  if (!userId) {
    return { error: { code: 'UNAUTHORIZED', message: 'Not logged in', statusCode: 401 } };
  }

  // Check req.auth.memberships first (includes synthetic memberships for ACCESS_GRANT sessions)
  const authMemberships = req.auth?.memberships || [];
  const activeMemberships = authMemberships.length > 0
    ? authMemberships
    : await prisma.dormitoryMember.findMany({
        where: { userId, status: 'active' },
        include: { role: true }
      });

  const allMemberships = activeMemberships.length > 0 ? activeMemberships : await prisma.dormitoryMember.findMany({
    where: { userId },
    include: { role: true }
  });

  const membership = allMemberships.find((m: any) => 
    !m.role || ['TENANT', 'OWNER', 'MANAGER', 'STAFF'].includes((m.role?.code || m.roleCode || '').toUpperCase())
  );

  if (!membership) {
    return { error: { code: 'FORBIDDEN', message: 'Not a tenant', statusCode: 403 } };
  }

  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${membership.dormitoryId}, true)`;

    const requestedRoomId = (req.headers['x-room-id'] as string) || (req.query.roomId as string) || (req.body?.roomId as string);

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId);

    const tenants = isUuid
      ? await tx.tenant.findMany({
          where: { linkedUserId: userId, dormitoryId: membership.dormitoryId, deletedAt: null }
        })
      : [];

    // If no registered tenant record exists yet: check if active access grant is linked to an approved tenant
    const candidateGrantId = req.auth?.session?.accessGrantId || (req.auth?.userId?.startsWith('ag_user_') ? req.auth.userId.replace('ag_user_', '') : null);
    if (tenants.length === 0 && candidateGrantId) {
      const grant = await tx.dormitoryAccessGrant.findUnique({
        where: { id: candidateGrantId },
        include: { lineFriend: true },
      });

      if (grant?.lineFriendId) {
        const approvedTenant = await tx.tenant.findFirst({
          where: {
            dormitoryId: membership.dormitoryId,
            lineFriendId: grant.lineFriendId,
            deletedAt: null,
            status: 'active',
          },
        });

        if (approvedTenant) {
          if (isUuid && !approvedTenant.linkedUserId) {
            await tx.tenant.update({
              where: { id: approvedTenant.id },
              data: { linkedUserId: userId },
            });
          }
          tenants.push(approvedTenant);
        }
      }
    }

    // If no registered tenant record exists yet: candidate tenant from LINE OA invite / access grant
    if (tenants.length === 0) {
      let pendingRequest: any = null;
      let lineFriend: any = null;

      if (candidateGrantId) {
        const grant = await tx.dormitoryAccessGrant.findUnique({
          where: { id: candidateGrantId },
          include: { lineFriend: true },
        });
        lineFriend = grant?.lineFriend;
        if (grant?.lineFriendId) {
          pendingRequest = await tx.tenantRegistrationRequest.findFirst({
            where: {
              dormitoryId: membership.dormitoryId,
              lineFollowerId: grant.lineFriendId,
              status: { in: ['pending_owner_approval', 'awaiting_tenant_confirmation', 'approved', 'rejected'] },
            },
            orderBy: { createdAt: 'desc' },
          });
        }
      }

      const registrationId = (req.headers['x-registration-id'] as string) || (req.query.registrationId as string);
      if (!pendingRequest && registrationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registrationId)) {
        pendingRequest = await tx.tenantRegistrationRequest.findFirst({
          where: {
            id: registrationId,
            dormitoryId: membership.dormitoryId,
            status: { in: ['pending_owner_approval', 'awaiting_tenant_confirmation', 'approved', 'rejected'] },
          },
        });
      }

      if (!pendingRequest && (req.auth?.user?.phone || (req as any).user?.phone)) {
        const phone = req.auth?.user?.phone || (req as any).user?.phone;
        pendingRequest = await tx.tenantRegistrationRequest.findFirst({
          where: {
            dormitoryId: membership.dormitoryId,
            phone,
            status: { in: ['pending_owner_approval', 'awaiting_tenant_confirmation', 'approved', 'rejected'] },
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (tenants.length === 0) {
        const userFirst = pendingRequest?.firstName || '';
        const userLast = pendingRequest?.lastName && pendingRequest.lastName !== '-' ? pendingRequest.lastName : '';
        const userFullName = userFirst ? `${userFirst} ${userLast}`.trim() : '';
        const lineDisplayName = lineFriend?.displayName || req.auth?.user?.name || (req as any).user?.name || null;
        const displayName = userFullName || 'ยังไม่ได้ลงทะเบียน';

        const rawCandidateEmail = req.auth?.user?.email || (req as any).user?.email || null;
        const candidateEmail = (rawCandidateEmail && !rawCandidateEmail.endsWith('@horplus.local')) ? rawCandidateEmail : null;

        const candidateTenant = {
          id: `candidate_${userId}`,
          tenantNumber: 'PENDING',
          firstName: userFirst,
          lastName: userLast,
          displayName: displayName,
          name: displayName,
          lineDisplayName: lineDisplayName,
          phone: pendingRequest?.phone || req.auth?.user?.phone || (req as any).user?.phone || null,
          email: candidateEmail,
          status: pendingRequest ? pendingRequest.status : 'unregistered',
          pendingRequestId: pendingRequest?.id || null,
          photoUrl: lineFriend?.pictureUrl || req.auth?.user?.avatarUrl || null,
          nationalIdMasked: null,
          nationalIdEncrypted: null,
          idCardObjectKey: null,
          petInfo: null,
          hasIdentityDocument: false,
          hasRoom: false,
          dormitoryId: membership.dormitoryId,
          pendingRequest: pendingRequest ? {
            id: pendingRequest.id,
            status: pendingRequest.status,
            requestedRoomNumber: pendingRequest.roomNumber || (pendingRequest as any).requestedRoomNumber,
            proposedRent: pendingRequest.proposedRent,
            proposedDeposit: pendingRequest.proposedDeposit,
            acceptanceSnapshot: pendingRequest.acceptanceSnapshot,
            rejectedReason: pendingRequest.rejectedReason,
          } : null,
        };

        return {
          tenant: candidateTenant,
          dormitoryId: membership.dormitoryId,
          contract: null,
          roomId: undefined,
          isCandidate: true,
        };
      }
    }

    const tenantIds = tenants.map(t => t.id);

    const contracts = await tx.contract.findMany({
      where: { tenantId: { in: tenantIds }, status: 'active' }
    });

    let contract = requestedRoomId
      ? contracts.find(c => c.roomId === requestedRoomId)
      : contracts[0];

    if (!contract && contracts.length > 0) {
      contract = contracts[0];
    }

    // Validate room ownership / tenancy strictly: contract takes priority, followed by active occupancy (e.g. daily stay)
    const occupancies = await tx.occupancy.findMany({
      where: { tenantId: { in: tenantIds }, status: 'ACTIVE' }
    });

    let validRoomId: string | undefined = undefined;
    if (contract?.roomId) {
      validRoomId = contract.roomId;
    } else if (requestedRoomId && occupancies.some(o => o.roomId === requestedRoomId)) {
      validRoomId = requestedRoomId;
    } else if (occupancies.length > 0 && occupancies[0].roomId) {
      validRoomId = occupancies[0].roomId;
    }

    const tenant = (contract ? tenants.find(t => t.id === contract.tenantId) : null) || tenants[0];

    return {
      tenant,
      dormitoryId: membership.dormitoryId,
      contract: contract || null,
      roomId: validRoomId
    };
  });
}

async function getTenantBillWhere(prisma: any, ctx: { dormitoryId: string; tenant: { id: string }; roomId?: string; isCandidate?: boolean }, asOfDate: Date = new Date()) {
  if (ctx.isCandidate || !/^[0-9a-fA-F-]{36}$/.test(ctx.tenant.id)) {
    return {
      dormitoryId: ctx.dormitoryId,
      id: '00000000-0000-0000-0000-000000000000',
      status: 'none',
    };
  }
  const contractWhere: any = {
    tenantId: ctx.tenant.id,
    dormitoryId: ctx.dormitoryId,
  };
  if (ctx.roomId) {
    contractWhere.roomId = ctx.roomId;
  }
  const contracts = await prisma.contract.findMany({
    where: contractWhere,
    select: { id: true }
  });
  const contractIds = contracts.map((c: any) => c.id);
  const cutoffDate = getTenantRentCutoffDate(asOfDate);

  const orConditions: any[] = [];
  if (ctx.roomId) {
    orConditions.push({ roomId: ctx.roomId });
  } else {
    orConditions.push({ tenantId: ctx.tenant.id });
  }
  if (contractIds.length > 0) {
    orConditions.push({ contractId: { in: contractIds } });
  }

  return {
    dormitoryId: ctx.dormitoryId,
    status: { not: 'cancelled' },
    OR: orConditions,
    // Future RENT Bill Visibility Gate: hide RENT bills before their billing cycle periodStart in Asia/Bangkok
    NOT: {
      AND: [
        { billKind: 'RENT' },
        {
          billingCycle: {
            periodStart: { gt: cutoffDate }
          }
        }
      ]
    }
  };
}

async function checkBillOwnership(prisma: any, billId: string, ctx: { dormitoryId: string; tenant: { id: string; linkedUserId?: string | null } }, asOfDate: Date = new Date()) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      items: true,
      billingCycle: true,
      Payment: {
        include: { receipt: true },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!bill || bill.dormitoryId !== ctx.dormitoryId || bill.status === 'cancelled') {
    return null;
  }

  // Future RENT Bill Visibility Gate: authoritative check in Asia/Bangkok
  if (!isBillVisibleToTenant(bill, asOfDate)) {
    return null;
  }

  const linkedUserId = ctx.tenant.linkedUserId;
  let allTenantIds = [ctx.tenant.id];
  if (linkedUserId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(linkedUserId)) {
    const userTenants = await prisma.tenant.findMany({
      where: { linkedUserId, dormitoryId: ctx.dormitoryId, deletedAt: null },
      select: { id: true }
    });
    if (userTenants.length > 0) {
      allTenantIds = userTenants.map((t: any) => t.id);
    }
  }

  const contracts = await prisma.contract.findMany({
    where: { tenantId: { in: allTenantIds }, dormitoryId: ctx.dormitoryId },
    select: { id: true }
  });
  const contractIds = contracts.map((c: any) => c.id);

  const isOwned = allTenantIds.includes(bill.tenantId) || (bill.contractId && contractIds.includes(bill.contractId));
  if (!isOwned) return null;

  return bill;
}

export function createTenantPortalRouter(authService?: AuthenticationService, injectedSensitiveFieldService?: SensitiveFieldService): Router {
  const router = Router();
  const prisma = getPrismaClient();

  const auditService = new AuditService();
  const maintenanceService = new MaintenanceService();
  const announcementService = new AnnouncementService();
  const sensitiveFieldService = injectedSensitiveFieldService || new SensitiveFieldService(process.env.FIELD_ENCRYPTION_KEY);

  if (authService) {
    router.use(authService.requireAuth());
  }

  // 0. Tenant Active Rooms & Available Rooms for Renting Additional Room
  router.get('/rooms', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } });
      }

      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId);
      let tenants = isUuid
        ? await prisma.tenant.findMany({
            where: { linkedUserId: userId, deletedAt: null },
            include: {
              dormitory: true,
              contracts: {
                where: { status: { in: ['active', 'approved_scheduled', 'expiring_soon', 'waiting_extension'] } },
                include: {
                  room: {
                    include: {
                      building: true
                    }
                  }
                }
              },
              occupancies: {
                where: { status: 'ACTIVE' },
                include: {
                  room: {
                    include: {
                      building: true
                    }
                  }
                }
              }
            }
          })
        : [];

      if (tenants.length === 0) {
        const candidateGrantId = req.auth?.session?.accessGrantId || (req.auth?.userId?.startsWith('ag_user_') ? req.auth.userId.replace('ag_user_', '') : null);
        let targetLineFriendId: string | null = null;
        if (candidateGrantId) {
          const grant = await prisma.dormitoryAccessGrant.findUnique({
            where: { id: candidateGrantId },
            select: { lineFriendId: true },
          });
          targetLineFriendId = grant?.lineFriendId || null;
        }

        const registrationId = (req.headers['x-registration-id'] as string) || (req.query.registrationId as string);
        let approvedTenantId: string | null = null;
        if (registrationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registrationId)) {
          const regReq = await prisma.tenantRegistrationRequest.findUnique({
            where: { id: registrationId },
            select: { approvedTenantId: true, lineFollowerId: true },
          });
          approvedTenantId = regReq?.approvedTenantId || null;
          if (!targetLineFriendId && regReq?.lineFollowerId) {
            targetLineFriendId = regReq.lineFollowerId;
          }
        }

        const phone = req.auth?.user?.phone || (req as any).user?.phone;

        const orFilters: any[] = [];
        if (targetLineFriendId) {
          orFilters.push({ lineFriendId: targetLineFriendId });
        }
        if (approvedTenantId) {
          orFilters.push({ id: approvedTenantId });
        }
        if (phone) {
          orFilters.push({ phone });
        }

        if (orFilters.length > 0) {
          tenants = await prisma.tenant.findMany({
            where: {
              OR: orFilters,
              deletedAt: null,
              status: 'active',
            },
            include: {
              dormitory: true,
              contracts: {
                where: { status: { in: ['active', 'approved_scheduled', 'expiring_soon', 'waiting_extension'] } },
                include: {
                  room: {
                    include: {
                      building: true,
                    },
                  },
                },
              },
              occupancies: {
                where: { status: 'ACTIVE' },
                include: {
                  room: {
                    include: {
                      building: true,
                    },
                  },
                },
              },
            },
          });
        }
      }

      const roomList: any[] = [];
      const seenRoomIds = new Set<string>();

      for (const t of tenants) {
        for (const c of t.contracts) {
          if (c.room && !seenRoomIds.has(c.room.id)) {
            seenRoomIds.add(c.room.id);
            roomList.push({
              roomId: c.room.id,
              roomNumber: c.room.roomNumber,
              floor: c.room.floor,
              buildingId: c.room.buildingId,
              buildingName: c.room.building?.name || 'อาคารหลัก',
              termMonths: Number(c.room.building?.termMonths || c.room.termMonths || 5),
              dormitoryId: t.dormitoryId,
              dormitoryName: t.dormitory.name,
              contractId: c.id,
              contractNumber: c.contractNumber,
              monthlyRent: Number(c.rentAmount || c.room.monthlyRent || 0),
              status: c.status,
              tenantId: t.id,
              tenantName: `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.displayName
            });
          }
        }

        for (const occ of t.occupancies) {
          if (occ.room && !seenRoomIds.has(occ.room.id)) {
            seenRoomIds.add(occ.room.id);
            roomList.push({
              roomId: occ.room.id,
              roomNumber: occ.room.roomNumber,
              floor: occ.room.floor,
              buildingId: occ.room.buildingId,
              buildingName: occ.room.building?.name || 'อาคารหลัก',
              termMonths: Number(occ.room.building?.termMonths || occ.room.termMonths || 5),
              dormitoryId: t.dormitoryId,
              dormitoryName: t.dormitory.name,
              contractId: null,
              contractNumber: null,
              monthlyRent: Number(occ.room.monthlyRent || 0),
              status: occ.status,
              tenantId: t.id,
              tenantName: `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.displayName
            });
          }
        }
      }

      if (roomList.length === 0) {
        try {
          const ctx = await resolveTenantContext(req);
          if (ctx && !ctx.error && ctx.roomId) {
            const foundRoom = await prisma.room.findUnique({
              where: { id: ctx.roomId },
              include: { building: true, dormitory: true }
            });
            if (foundRoom) {
              roomList.push({
                roomId: foundRoom.id,
                roomNumber: foundRoom.roomNumber,
                floor: foundRoom.floor,
                buildingId: foundRoom.buildingId,
                buildingName: foundRoom.building?.name || 'อาคารหลัก',
                termMonths: Number(foundRoom.building?.termMonths || foundRoom.termMonths || 5),
                dormitoryId: foundRoom.dormitoryId,
                dormitoryName: foundRoom.dormitory?.name || (ctx.dormitoryId ? 'หอพัก' : 'หอพัก HorPlus'),
                contractId: ctx.contract?.id || null,
                contractNumber: ctx.contract?.contractNumber || null,
                monthlyRent: Number(ctx.contract?.rentAmount || foundRoom.monthlyRent || 0),
                status: ctx.contract?.status || 'active',
                tenantId: ctx.tenant?.id || null,
                tenantName: `${ctx.tenant?.firstName || ''} ${ctx.tenant?.lastName || ''}`.trim() || ctx.tenant?.displayName || 'ผู้เช่า'
              });
            }
          }
        } catch {}
      }

      res.json({
        success: true,
        rooms: roomList
      });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/available-rooms', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message } });
      }

      const rooms = await prisma.room.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          status: { in: ['vacant', 'reserved', 'VACANT', 'RESERVED', 'available', 'AVAILABLE'] },
          deletedAt: null,
          ...(ctx.roomId ? { id: { not: ctx.roomId } } : {})
        },
        include: {
          building: true
        },
        orderBy: [
          { roomNumber: 'asc' }
        ]
      });

      rooms.sort((a, b) => {
        const bldCompare = (a.building?.name || '').localeCompare(b.building?.name || '', 'th');
        if (bldCompare !== 0) return bldCompare;
        return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
      });

      const defaults = await prisma.dormitoryPropertyDefaults.findUnique({
        where: { dormitoryId: ctx.dormitoryId },
        select: { version: true }
      });
      const policyVersion = defaults?.version ?? 1;

      res.json({
        success: true,
        policyVersion,
        data: rooms.map(r => ({
          id: r.id,
          roomNumber: r.roomNumber,
          floor: r.floor,
          buildingId: r.buildingId,
          buildingName: r.building?.name || 'อาคารหลัก',
          monthlyRent: Number(r.monthlyRent || 0),
          status: r.status,
          policyVersion,
        }))
      });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/utilities', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message } });
      }

      if (!ctx.roomId) {
        return res.json({ success: true, data: { water: null, electric: null, readings: [] } });
      }

      // Tenancy boundary isolation: only include readings since the current tenant's earliest tenancy start date in this room
      const tenantContracts = await prisma.contract.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          roomId: ctx.roomId,
          tenantId: ctx.tenant.id,
        },
        orderBy: { startDate: 'asc' },
        select: { startDate: true }
      });
      const earliestStartDate = tenantContracts.length > 0 ? tenantContracts[0].startDate : (ctx.contract?.startDate || null);

      const readings = await prisma.meterReading.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          roomId: ctx.roomId,
          ...(earliestStartDate ? { readAt: { gte: earliestStartDate } } : {})
        },
        orderBy: { readAt: 'desc' },
        take: 24
      });

      const latestWater = readings.find(r => r.meterType.toLowerCase() === 'water');
      const latestElectric = readings.find(r => r.meterType.toLowerCase() === 'electric' || r.meterType.toLowerCase() === 'electricity');

      const room = ctx.roomId ? await prisma.room.findUnique({
        where: { id: ctx.roomId },
        select: {
          waterRate: true,
          electricityRate: true,
          waterBillingType: true,
          electricityBillingType: true,
        }
      }) : null;

      const billingSettings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: ctx.dormitoryId }
      });

      const coOccupantsCount = await prisma.tenantCoOccupant.count({
        where: { tenantId: ctx.tenant.id, dormitoryId: ctx.dormitoryId, deletedAt: null }
      });
      const peopleCount = 1 + coOccupantsCount;

      const waterBillingType = (room?.waterBillingType || billingSettings?.waterBillingType || 'per_unit').toLowerCase();
      const electricityBillingType = (room?.electricityBillingType || billingSettings?.electricityBillingType || 'per_unit').toLowerCase();

      const waterUnitPrice = Number(room?.waterRate ?? billingSettings?.waterRate ?? 18);
      const electricUnitPrice = Number(room?.electricityRate ?? billingSettings?.electricityRate ?? 8);

      res.json({
        success: true,
        data: {
          waterBillingType,
          electricityBillingType,
          waterRate: waterUnitPrice,
          electricityRate: electricUnitPrice,
          waterTierRates: billingSettings?.waterTierRates || null,
          electricityTierRates: billingSettings?.electricityTierRates || null,
          peopleCount,
          latestWater: latestWater ? {
            id: latestWater.id,
            previousReading: latestWater.previousReading !== null && latestWater.previousReading !== undefined ? Number(latestWater.previousReading) : null,
            currentReading: (latestWater.currentReading !== null && latestWater.currentReading !== undefined && !(Number(latestWater.previousReading) > 0 && Number(latestWater.currentReading) === 0)) ? Number(latestWater.currentReading) : null,
            usageUnits: (latestWater.usageUnits !== null && latestWater.usageUnits !== undefined && !(Number(latestWater.previousReading) > 0 && Number(latestWater.currentReading) === 0)) ? Number(latestWater.usageUnits) : null,
            unitPrice: waterUnitPrice,
            readAt: latestWater.readAt.toISOString()
          } : null,
          latestElectric: latestElectric ? {
            id: latestElectric.id,
            previousReading: latestElectric.previousReading !== null && latestElectric.previousReading !== undefined ? Number(latestElectric.previousReading) : null,
            currentReading: (latestElectric.currentReading !== null && latestElectric.currentReading !== undefined && !(Number(latestElectric.previousReading) > 0 && Number(latestElectric.currentReading) === 0)) ? Number(latestElectric.currentReading) : null,
            usageUnits: (latestElectric.usageUnits !== null && latestElectric.usageUnits !== undefined && !(Number(latestElectric.previousReading) > 0 && Number(latestElectric.currentReading) === 0)) ? Number(latestElectric.usageUnits) : null,
            unitPrice: electricUnitPrice,
            readAt: latestElectric.readAt.toISOString()
          } : null,
          readings: readings.map(r => ({
            id: r.id,
            meterType: r.meterType,
            previousReading: r.previousReading !== null && r.previousReading !== undefined ? Number(r.previousReading) : null,
            currentReading: r.currentReading !== null && r.currentReading !== undefined ? Number(r.currentReading) : null,
            usageUnits: r.usageUnits !== null && r.usageUnits !== undefined ? Number(r.usageUnits) : null,
            readAt: r.readAt.toISOString()
          }))
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // 1. Tenant Profile & Room Members
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const tenant = ctx.tenant;
      const contract = ctx.contract;
      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId } }) : null;
      const dorm = await prisma.dormitory.findUnique({ where: { id: ctx.dormitoryId } });
      const propDefaults = await prisma.dormitoryPropertyDefaults.findUnique({
        where: { dormitoryId: ctx.dormitoryId },
        select: { petPolicy: true }
      });

      if (ctx.isCandidate) {
        return res.json({
          id: tenant.id,
          tenantNumber: tenant.tenantNumber,
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          displayName: tenant.displayName,
          name: tenant.name,
          phone: tenant.phone,
          email: tenant.email,
          status: tenant.status,
          pictureUrl: tenant.photoUrl,
          nationalIdMasked: null,
          citizenId: null,
          hasIdentityDocument: false,
          idCardPhotoMock: null,
          idCardPhotoUrl: null,
          emergencyContact: null,
          emergencyContacts: [],
          vehicles: [],
          vehicle: null,
          pet: { hasPet: false, type: '', name: '' },
          pets: [],
          coOccupants: [],
          dormitory: {
            id: dorm?.id || ctx.dormitoryId,
            name: dorm?.name || 'หอพัก',
            petPolicy: propDefaults?.petPolicy || { allowed: 'none', allowedTypes: [] },
          },
          room: null,
          contract: null,
          hasRoom: false,
          pendingRequestId: tenant.pendingRequestId || null,
          pendingRequest: tenant.pendingRequest || null,
        });
      }

      const coOccupants = await prisma.tenantCoOccupant.findMany({
        where: { tenantId: tenant.id, dormitoryId: ctx.dormitoryId, deletedAt: null }
      });

      const vehicles = await prisma.tenantVehicle.findMany({
        where: { tenantId: tenant.id, dormitoryId: ctx.dormitoryId, status: 'active' }
      });
      const primaryVehicle = vehicles[0] || null;
      const petInfo = tenant.petInfo
        ? (typeof tenant.petInfo === 'string' ? JSON.parse(tenant.petInfo) : tenant.petInfo)
        : null;

      const emergencyContacts = await prisma.tenantEmergencyContact.findMany({
        where: { tenantId: tenant.id, dormitoryId: ctx.dormitoryId }
      });
      const primaryEmergency = emergencyContacts[0] ? {
        name: emergencyContacts[0].name,
        relationship: emergencyContacts[0].relationship,
        phone: emergencyContacts[0].phone
      } : null;

      const phone = tenant.phone || null;
      let rawCitizenId = tenant.nationalIdMasked || null;
      if (tenant.nationalIdEncrypted) {
        try {
          rawCitizenId = sensitiveFieldService.decrypt(tenant.nationalIdEncrypted);
        } catch (e) {
          rawCitizenId = tenant.nationalIdMasked || null;
        }
      }
      if (rawCitizenId && rawCitizenId.replace(/\D/g, '').length === 13) {
        const c = rawCitizenId.replace(/\D/g, '');
        rawCitizenId = `${c[0]}-${c.slice(1, 5)}-${c.slice(5, 10)}-${c.slice(10, 12)}-${c[12]}`;
      }

      const realLegalName = (tenant.firstName && tenant.firstName !== '-')
        ? `${tenant.firstName} ${tenant.lastName && tenant.lastName !== '-' ? tenant.lastName : ''}`.trim()
        : '';
      const effectiveTenantDisplayName = realLegalName || tenant.displayName || 'ผู้เช่า';

      res.json({
        id: tenant.id,
        tenantNumber: tenant.tenantNumber,
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        displayName: effectiveTenantDisplayName,
        name: effectiveTenantDisplayName,
        phone,
        email: tenant.email,
        status: tenant.status,
        pictureUrl: tenant.photoUrl || null,
        nationalIdMasked: tenant.nationalIdMasked || null,
        citizenId: rawCitizenId,
        hasIdentityDocument: !!(tenant.idCardObjectKey || tenant.photoUrl),
        idCardPhotoMock: tenant.idCardObjectKey ? '/api/v1/tenant-portal/id-card-photo' : (tenant.photoUrl || null),
        idCardPhotoUrl: tenant.idCardObjectKey ? '/api/v1/tenant-portal/id-card-photo' : (tenant.photoUrl || null),
        emergencyContact: primaryEmergency,
        emergencyContacts: emergencyContacts.map((ec: any) => ({
          name: ec.name,
          relationship: ec.relationship,
          phone: ec.phone
        })),
        dormitory: dorm ? {
          id: dorm.id,
          name: dorm.name,
          addressLine1: dorm.addressLine1 || (dorm as any).address,
          address: dorm.addressLine1 || (dorm as any).address,
          subdistrict: dorm.subdistrict,
          district: dorm.district,
          province: dorm.province,
          postalCode: dorm.postalCode,
          phone: dorm.phone,
          logoUrl: (dorm as any).logoUrl || null,
          petPolicy: propDefaults?.petPolicy || (dorm as any).petPolicy || null
        } : null,
        room: room ? {
          id: room.id,
          roomNumber: room.roomNumber,
          roomType: room.roomType,
          buildingId: room.buildingId
        } : null,
        roomMembers: [],
        vehicle: primaryVehicle ? {
          type: primaryVehicle.type,
          licensePlate: primaryVehicle.licensePlate,
          brand: primaryVehicle.brand || '',
          model: primaryVehicle.model || '',
          color: primaryVehicle.color || '',
        } : null,
        vehicles: vehicles.map((v: any) => ({
          id: v.id,
          type: v.type,
          licensePlate: v.licensePlate,
          brand: v.brand || '',
          model: v.model || '',
          color: v.color || '',
        })),
        pet: petInfo || { hasPet: false, type: '', name: '' },
        pets: Array.isArray(petInfo?.pets)
          ? petInfo.pets
          : (petInfo?.hasPet && petInfo?.type
            ? [{ id: 'pet-1', type: petInfo.type, customType: petInfo.customType || '', name: petInfo.name || '' }]
            : []),
        coOccupants: coOccupants.map((c: any) => ({
          id: c.id,
          name: c.name,
          relationship: c.relationship,
          phone: c.phone
        })),
        activeContract: contract ? {
          id: contract.id,
          contractNumber: contract.contractNumber,
          status: contract.status,
          startDate: contract.startDate.toISOString(),
          endDate: contract.endDate.toISOString(),
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          rentBillingType: contract.rentBillingType,
          rentAmount: contract.rentAmount.toString(),
          depositAmount: contract.depositAmount.toString(),
          advancePaymentAmount: contract.advancePaymentAmount.toString(),
          coOccupantsCount: coOccupants.length
        } : null
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  router.patch('/profile', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { vehicle, vehicles, pet, pets } = req.body;
      const tenantId = ctx.tenant.id;
      const dormitoryId = ctx.dormitoryId;

      const propDefaults = await prisma.dormitoryPropertyDefaults.findUnique({
        where: { dormitoryId },
        select: { petPolicy: true }
      });
      const petPolicyAllowed = (propDefaults?.petPolicy as any)?.allowed;
      const isPetRestricted = petPolicyAllowed === 'none' || petPolicyAllowed === 'not_allowed';

      // 1. Update Pet in tenant.petInfo
      if (pets !== undefined) {
        const petsList = Array.isArray(pets) ? pets : [];
        if (isPetRestricted && petsList.length > 0) {
          return res.status(400).json({
            error: {
              code: 'PET_POLICY_RESTRICTED',
              message: 'หอพักไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก',
              requestId: req.requestId
            }
          });
        }
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            petInfo: {
              hasPet: petsList.length > 0,
              pets: petsList.map((p: any) => ({
                id: p.id || `pet-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                type: p.type || 'other',
                customType: p.customType || '',
                name: p.name || ''
              })),
              type: petsList[0]?.type || '',
              name: petsList[0]?.name || ''
            }
          }
        });
      } else if (pet !== undefined) {
        if (isPetRestricted && pet?.hasPet) {
          return res.status(400).json({
            error: {
              code: 'PET_POLICY_RESTRICTED',
              message: 'หอพักไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก',
              requestId: req.requestId
            }
          });
        }
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            petInfo: pet ? {
              hasPet: Boolean(pet.hasPet),
              type: pet.type || '',
              customType: pet.customType || '',
              name: pet.name || '',
              pets: pet.hasPet && pet.type ? [{ id: 'pet-1', type: pet.type, customType: pet.customType || '', name: pet.name || '' }] : []
            } : { hasPet: false, type: '', customType: '', name: '', pets: [] }
          }
        });
      }

      // 2. Update Vehicle in tenant_vehicles
      if (vehicles !== undefined && Array.isArray(vehicles)) {
        await prisma.tenantVehicle.updateMany({
          where: { tenantId, dormitoryId, status: 'active' },
          data: { status: 'inactive' }
        });
        for (const v of vehicles) {
          if (v && v.licensePlate && v.type !== 'none') {
            await prisma.tenantVehicle.create({
              data: {
                dormitoryId,
                tenantId,
                type: v.type || 'car',
                licensePlate: v.licensePlate.trim(),
                brand: v.brand || '',
                model: v.model || '',
                color: v.color || '',
                status: 'active'
              }
            });
          }
        }
      } else if (vehicle !== undefined) {
        if (vehicle && vehicle.licensePlate && vehicle.type !== 'none') {
          const existingVehicle = await prisma.tenantVehicle.findFirst({
            where: { tenantId, dormitoryId, status: 'active' }
          });
          if (existingVehicle) {
            await prisma.tenantVehicle.update({
              where: { id: existingVehicle.id },
              data: {
                type: vehicle.type || 'car',
                licensePlate: vehicle.licensePlate.trim(),
                brand: vehicle.brand || '',
                model: vehicle.model || '',
                color: vehicle.color || '',
              }
            });
          } else {
            await prisma.tenantVehicle.create({
              data: {
                dormitoryId,
                tenantId,
                type: vehicle.type || 'car',
                licensePlate: vehicle.licensePlate.trim(),
                brand: vehicle.brand || '',
                model: vehicle.model || '',
                color: vehicle.color || '',
                status: 'active'
              }
            });
          }
        } else if (vehicle === null || vehicle.type === 'none' || !vehicle.licensePlate) {
          await prisma.tenantVehicle.updateMany({
            where: { tenantId, dormitoryId, status: 'active' },
            data: { status: 'inactive' }
          });
        }
      }

      const updatedTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const updatedVehicles = await prisma.tenantVehicle.findMany({
        where: { tenantId, dormitoryId, status: 'active' }
      });
      const activeVeh = updatedVehicles[0] || null;
      const updatedPetInfo = updatedTenant?.petInfo
        ? (typeof updatedTenant.petInfo === 'string' ? JSON.parse(updatedTenant.petInfo) : updatedTenant.petInfo)
        : null;

      res.json({
        success: true,
        data: {
          vehicle: activeVeh ? {
            type: activeVeh.type,
            licensePlate: activeVeh.licensePlate,
            brand: activeVeh.brand || '',
            model: activeVeh.model || '',
            color: activeVeh.color || '',
          } : null,
          vehicles: updatedVehicles.map((v: any) => ({
            id: v.id,
            type: v.type,
            licensePlate: v.licensePlate,
            brand: v.brand || '',
            model: v.model || '',
            color: v.color || '',
          })),
          pet: updatedPetInfo || { hasPet: false, type: '', name: '' },
          pets: Array.isArray(updatedPetInfo?.pets) ? updatedPetInfo.pets : []
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 2. Tenant Contract
  router.get('/contract', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      if (!ctx.contract) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบข้อมูลสัญญาเช่า', requestId: req.requestId }
        });
      }

      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId } }) : null;

      return res.json({
        success: true,
        data: {
          id: ctx.contract.id,
          contractNumber: ctx.contract.contractNumber,
          status: ctx.contract.status,
          startDate: ctx.contract.startDate.toISOString(),
          endDate: ctx.contract.endDate.toISOString(),
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          rentBillingType: ctx.contract.rentBillingType,
          rentAmount: ctx.contract.rentAmount.toString(),
          depositAmount: ctx.contract.depositAmount.toString(),
          advancePaymentAmount: ctx.contract.advancePaymentAmount.toString(),
          coOccupantsCount: 0
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 3. Tenant Bills List
  router.get('/bills', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const bills = await prisma.bill.findMany({
        where: billWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          Payment: {
            include: { receipt: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      const formatted = bills.map((b) => {
        const mappedPayments = (b.Payment || []).map((p) => ({
          id: p.id,
          method: p.method,
          amount: p.amount.toString(),
          status: p.status,
          paymentDate: p.paymentDate ? p.paymentDate.toISOString() : null,
          rejectedReason: p.rejectedReason || null,
          reversalReason: p.reversalReason || null,
          reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
          createdAt: p.createdAt.toISOString(),
          receipt: p.receipt ? {
            id: p.receipt.id,
            receiptNumber: p.receipt.receiptNumber,
            isVoided: p.receipt.isVoided
          } : null
        }));

        const effectivePaidAt = b.paidAt
          ? b.paidAt.toISOString()
          : (mappedPayments.find((p: any) => p.status === 'APPROVED')?.paymentDate || mappedPayments[0]?.paymentDate || null);

        return {
          id: b.id,
          tenantId: b.tenantId || ctx.tenant.id,
          billNumber: b.billNumber,
          billKind: b.billKind || 'MONTHLY_UTILITY',
          billingCycleId: b.billingCycleId,
          cycleId: b.billingCycleId,
          billingDate: b.billingDate.toISOString(),
          dueDate: b.dueDate ? b.dueDate.toISOString() : null,
          paidAt: effectivePaidAt,
          createdAt: b.createdAt.toISOString(),
          status: b.status,
          totalAmount: b.totalAmount.toString(),
          paidAmount: b.paidAmount.toString(),
          outstandingAmount: b.outstandingAmount.toString(),
          items: b.items.map((item: any) => ({
            id: item.id,
            type: item.itemType || item.type,
            description: item.description,
            amount: item.amount.toString(),
            quantity: item.quantity !== undefined && item.quantity !== null ? item.quantity.toString() : null,
            unit: item.unit || null,
            unitPrice: item.unitPrice ? item.unitPrice.toString() : null,
            meterStart: item.meterStart,
            meterEnd: item.meterEnd,
            unitUsed: item.unitUsed,
            metadata: item.metadata || null
          })),
          payments: mappedPayments,
          Payment: mappedPayments
        };
      });

      return res.status(200).json({ data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 4. Tenant Bill Detail
  router.get('/bills/:billId', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const bill = await checkBillOwnership(prisma, req.params.billId, ctx);
      if (!bill) {
        return res.status(404).json({
          error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId }
        });
      }

      const room = bill.roomId ? await prisma.room.findUnique({ where: { id: bill.roomId } }) : null;

      const mappedPayments = (bill.Payment || []).map((p: any) => ({
        id: p.id,
        method: p.method,
        amount: p.amount.toString(),
        status: p.status,
        paymentDate: p.paymentDate.toISOString(),
        rejectedReason: p.rejectedReason || null,
        reversalReason: p.reversalReason || null,
        reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        receipt: p.receipt ? {
          id: p.receipt.id,
          receiptNumber: p.receipt.receiptNumber,
          isVoided: p.receipt.isVoided
        } : null
      }));

      const effectivePaidAt = bill.paidAt
        ? bill.paidAt.toISOString()
        : (mappedPayments.find((p: any) => p.status === 'APPROVED')?.paymentDate || mappedPayments[0]?.paymentDate || null);

      return res.json({
        success: true,
        data: {
          id: bill.id,
          tenantId: bill.tenantId,
          billNumber: bill.billNumber,
          billKind: bill.billKind || 'MONTHLY_UTILITY',
          billingDate: bill.billingDate.toISOString(),
          dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
          paidAt: effectivePaidAt,
          status: bill.status,
          totalAmount: bill.totalAmount.toString(),
          paidAmount: bill.paidAmount.toString(),
          outstandingAmount: bill.outstandingAmount.toString(),
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          items: bill.items.map((it: any) => ({
            id: it.id,
            type: it.type || it.itemType || 'other',
            itemType: it.type || it.itemType || 'other',
            description: it.description,
            amount: it.amount.toString(),
            quantity: it.quantity !== undefined && it.quantity !== null ? it.quantity.toString() : null,
            unit: it.unit || null,
            unitPrice: it.unitPrice ? it.unitPrice.toString() : null,
            metadata: it.metadata || null
          })),
          payments: mappedPayments,
          Payment: mappedPayments
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 5. Tenant Payment Options (Safe DTO without raw PromptPay identifier)
  router.get('/payment-options/:billId/qr', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      let qrAmount = '0.00';
      const billIdParam = req.params.billId;
      if (req.query.amount) {
        qrAmount = Number(req.query.amount).toFixed(2);
      } else if (billIdParam.includes(',')) {
        const ids = billIdParam.split(',').filter(Boolean);
        const bills = await prisma.bill.findMany({
          where: { id: { in: ids }, dormitoryId: ctx.dormitoryId }
        });
        const sum = bills.reduce((acc: number, b: any) => acc + Number(b.totalAmount || 0), 0);
        qrAmount = sum.toFixed(2);
      } else {
        const bill = await checkBillOwnership(prisma, billIdParam, ctx);
        if (!bill) {
          return res.status(404).json({ error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId } });
        }
        qrAmount = bill.totalAmount.toString();
      }

      const settings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: ctx.dormitoryId }
      });

      if (!settings || !settings.promptPayValueEncrypted) {
        return res.status(404).json({ error: { code: 'PROMPTPAY_NOT_CONFIGURED', message: 'ไม่ได้ตั้งค่า PromptPay', requestId: req.requestId } });
      }

      let rawPromptPay: string;
      try {
        rawPromptPay = sensitiveFieldService.decrypt(settings.promptPayValueEncrypted);
      } catch (err) {
        console.error('[TenantPortal] PromptPay decryption failed for QR endpoint:', err);
        return res.status(500).json({ error: { code: 'PAYMENT_METHOD_CONFIGURATION_ERROR', message: 'เกิดข้อผิดพลาดในการอ่านข้อมูล PromptPay', requestId: req.requestId } });
      }

      const svg = await generatePromptPayQrSvg(rawPromptPay, qrAmount);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.status(200).send(svg);
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  router.get('/payment-options/:billId?', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      let targetAmount = '0.00';
      let targetBillId = '';

      if (req.query.billIds) {
        const ids = (req.query.billIds as string).split(',').filter(Boolean);
        const bills = await prisma.bill.findMany({
          where: { id: { in: ids }, dormitoryId: ctx.dormitoryId, status: { not: 'cancelled' } }
        });
        const total = bills.reduce((sum: number, b: any) => sum + Number(b.totalAmount || 0), 0);
        targetAmount = total.toFixed(2);
        targetBillId = ids.join(',');
      } else if (req.params.billId && req.params.billId.includes(',')) {
        const ids = req.params.billId.split(',').filter(Boolean);
        const bills = await prisma.bill.findMany({
          where: { id: { in: ids }, dormitoryId: ctx.dormitoryId, status: { not: 'cancelled' } }
        });
        const total = bills.reduce((sum: number, b: any) => sum + Number(b.totalAmount || 0), 0);
        targetAmount = total.toFixed(2);
        targetBillId = ids.join(',');
      } else if (req.params.billId) {
        const bill = await checkBillOwnership(prisma, req.params.billId, ctx);
        if (!bill) {
          return res.status(404).json({ error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId } });
        }
        targetAmount = bill.totalAmount.toString();
        targetBillId = bill.id;
      } else {
        const billWhere = await getTenantBillWhere(prisma, ctx);
        const bill = await prisma.bill.findFirst({
          where: {
            ...billWhere,
            status: { in: ['ISSUED', 'ISSUED_OVERDUE', 'REJECTED', 'issued', 'pending', 'overdue', 'rejected'] }
          },
          orderBy: { createdAt: 'desc' }
        });
        if (bill) {
          targetAmount = bill.totalAmount.toString();
          targetBillId = bill.id;
        }
      }

      const settings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: ctx.dormitoryId }
      });
      const dorm = await prisma.dormitory.findUnique({
        where: { id: ctx.dormitoryId }
      });

      if (!settings) {
        return res.json({
          success: true,
          data: {
            promptPayConfigured: false,
            bankTransferConfigured: false,
            configured: false,
            targetAmount,
            paymentMethod: 'PROMPTPAY',
            qrUrl: null
          }
        });
      }

      let rawPromptPay: string | null = null;
      let decryptionError = false;

      if (settings.promptPayValueEncrypted) {
        try {
          rawPromptPay = sensitiveFieldService.decrypt(settings.promptPayValueEncrypted);
        } catch (err) {
          console.error('[TenantPortal] PromptPay decryption failed:', err);
          decryptionError = true;
        }
      }

      let rawBankAcc: string | null = null;
      if (settings.bankAccountNumberEncrypted) {
        try {
          rawBankAcc = sensitiveFieldService.decrypt(settings.bankAccountNumberEncrypted);
        } catch (err) {
          console.error('[TenantPortal] Bank account decryption failed:', err);
        }
      } else if (settings.bankAccountNumber && !settings.bankAccountNumber.includes('X') && !settings.bankAccountNumber.includes('*')) {
        rawBankAcc = settings.bankAccountNumber;
      }

      const promptPayConfigured = Boolean(rawPromptPay && !decryptionError);
      const bankTransferConfigured = Boolean(rawBankAcc || settings.bankAccountNumber);
      const isConfigured = promptPayConfigured || bankTransferConfigured;

      return res.json({
        success: true,
        data: {
          configured: isConfigured,
          promptPayConfigured,
          bankTransferConfigured,
          ...(decryptionError ? { errorCode: 'PAYMENT_METHOD_CONFIGURATION_ERROR' } : {}),
          targetAmount,
          paymentMethod: 'PROMPTPAY',
          promptPayType: settings.promptPayType || 'NATID',
          promptPayDisplay: promptPayConfigured ? formatPromptPayDisplay(rawPromptPay!, settings.promptPayType) : null,
          promptPayAccountName: settings.promptPayAccountName || dorm?.name || null,
          qrUrl: (promptPayConfigured && targetBillId) ? `/api/v1/tenant-portal/payment-options/${targetBillId}/qr${ctx.roomId ? `?roomId=${ctx.roomId}` : ''}` : null,
          bankCode: settings.bankCode || null,
          bankAccountName: settings.bankAccountName || null,
          bankAccountNumber: rawBankAcc || settings.bankAccountNumber || null,
          bankQrCode: settings.bankQrCode || null
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 6. Tenant Payment History List
  router.get('/payments', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const payments = await prisma.payment.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          OR: [
            { tenantId: ctx.tenant.id },
            { bill: billWhere }
          ]
        },
        orderBy: { createdAt: 'desc' },
        include: {
          bill: { select: { id: true, billNumber: true, totalAmount: true } },
          receipt: { select: { id: true, receiptNumber: true, isVoided: true, voidReason: true } }
        }
      });

      const formatted = payments.map((p) => ({
        id: p.id,
        billId: p.billId,
        billNumber: p.bill?.billNumber || 'ไม่ระบุ',
        method: p.method,
        amount: p.amount.toString(),
        status: p.status,
        paymentDate: p.paymentDate ? p.paymentDate.toISOString() : null,
        rejectedReason: p.rejectedReason || null,
        reversalReason: p.reversalReason || null,
        reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        receipt: p.receipt ? {
          id: p.receipt.id,
          receiptNumber: p.receipt.receiptNumber,
          isVoided: p.receipt.isVoided,
          voidReason: p.receipt.voidReason || null
        } : null
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 7. Tenant Receipts List
  router.get('/receipts', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const receipts = await prisma.receipt.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          bill: billWhere
        },
        orderBy: { createdAt: 'desc' },
        include: {
          bill: { select: { id: true, billNumber: true, totalAmount: true } }
        }
      });

      const formatted = receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        billId: r.billId,
        billNumber: r.bill?.billNumber || 'ไม่ระบุ',
        totalAmount: r.bill?.totalAmount ? r.bill.totalAmount.toString() : '0.00',
        isVoided: r.isVoided,
        voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
        voidReason: r.voidReason || null,
        createdAt: r.createdAt.toISOString()
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 8. Tenant Dashboard Summary
  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billingState = ctx.roomId
        ? await roomBillingStateService.getTenantRoomBillingState(ctx.dormitoryId, ctx.roomId, ctx.tenant.id, new Date())
        : { state: 'no_bill' as const, outstandingAmount: '0.00', statusText: 'ไม่มีรายการค้างชำระ' };

      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId } }) : null;

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const latestReceipt = await prisma.receipt.findFirst({
        where: {
          dormitoryId: ctx.dormitoryId,
          bill: billWhere
        },
        orderBy: { createdAt: 'desc' }
      });

      return res.json({
        success: true,
        data: {
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          contractStatus: ctx.contract?.status || 'active',
          billingState: billingState.state,
          currentBillId: billingState.currentBillId || null,
          billNumber: billingState.billNumber || null,
          outstandingAmount: billingState.outstandingAmount,
          statusText: billingState.statusText,
          dueDate: billingState.dueDate ? billingState.dueDate.toISOString() : null,
          latestReceiptNumber: latestReceipt?.receiptNumber || null
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 9. Tenant Maintenance Routes
  router.get('/maintenance', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      if (ctx.isCandidate || !/^[0-9a-fA-F-]{36}$/.test(ctx.tenant.id)) {
        return res.json({ success: true, data: [] });
      }

      const requests = await maintenanceService.getTenantRequests(ctx.dormitoryId, ctx.tenant.id);
      const filtered = ctx.roomId ? requests.filter((r: any) => !r.roomId || r.roomId === ctx.roomId) : requests;
      return res.json({ success: true, data: filtered });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { category, title, description, priority, preferredDate, preferredTimeRange, imageBefore } = req.body;

      if (!category || !title || !description) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Category, title, and description are required', requestId: req.requestId } });
      }

      const targetRoomId = req.body?.roomId || ctx.roomId;
      if (!targetRoomId) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Room context missing for tenant', requestId: req.requestId } });
      }

      const request = await maintenanceService.createRequestByTenant({
        dormitoryId: ctx.dormitoryId,
        tenantId: ctx.tenant.id,
        contractId: ctx.contract?.id || undefined,
        roomId: targetRoomId,
        category,
        title,
        description,
        priority,
        preferredDate,
        preferredTimeRange,
        imageBefore: imageBefore || undefined
      });

      return res.status(201).json({ success: true, data: request });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/maintenance/:requestId', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const detail = await maintenanceService.getTenantRequestById(ctx.dormitoryId, ctx.tenant.id, req.params.requestId);

      if (!detail) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบรายการแจ้งซ่อมนี้', requestId: req.requestId } });
      }

      return res.json({ success: true, data: detail });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance/:requestId/comments', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required', requestId: req.requestId } });
      }

      const senderName = `${ctx.tenant.firstName} ${ctx.tenant.lastName}`.trim() || 'ผู้เช่า';

      const comment = await maintenanceService.addComment(ctx.dormitoryId, req.params.requestId, {
        senderType: 'tenant',
        senderTenantId: ctx.tenant.id,
        senderName,
        message,
        visibility: 'tenant_visible'
      });

      return res.status(201).json({ success: true, data: comment });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance/:requestId/cancel', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { reason } = req.body;
      const cancelled = await maintenanceService.cancelByTenant(ctx.dormitoryId, ctx.tenant.id, req.params.requestId, reason);
      return res.json({ success: true, data: cancelled });
    } catch (err: any) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message, requestId: req.requestId } });
    }
  });

  // 10. Tenant Announcement Routes
  router.get('/announcements', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const list = await announcementService.getTenantAnnouncements(ctx.dormitoryId, ctx.tenant.id);
      return res.json({ success: true, data: list });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/announcements/:id', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const announcement = await announcementService.getTenantAnnouncementById(ctx.dormitoryId, ctx.tenant.id, req.params.id);

      if (!announcement) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบประกาศนี้', requestId: req.requestId } });
      }

      return res.json({ success: true, data: announcement });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/announcements/:id/read', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const result = await announcementService.markAsReadByTenant(ctx.dormitoryId, req.params.id, ctx.tenant.id);
      return res.json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/announcements/read-all', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const count = await announcementService.markAllAsReadByTenant(ctx.dormitoryId, ctx.tenant.id);
      return res.json({ success: true, data: { markedCount: count } });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // Tenant Contract PDF Download
  router.get('/contract/pdf', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      if (!ctx.contract) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบสัญญาเช่าของคุณ', requestId: req.requestId }
        });
      }

      const dorm = await prisma.dormitory.findUnique({
        where: { id: ctx.dormitoryId },
        include: {
          billingSettings: true,
          propertyDefaults: true,
          members: {
            where: { role: { code: 'OWNER' } },
            include: { user: true },
          },
          ownerSignatures: {
            where: { isCurrent: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId }, include: { building: true } }) : null;
      const snapshot = await prisma.contractSnapshot.findFirst({
        where: { contractId: ctx.contract.id, dormitoryId: ctx.dormitoryId },
      });

      const formatRate = (val: any): string => {
        if (val !== undefined && val !== null && val !== '') {
          const num = Number(val);
          if (!isNaN(num)) {
            return num.toFixed(2);
          }
        }
        return 'ไม่ระบุ';
      };

      const resolvedRoomNumber = snapshot?.exactRoomNumber || room?.roomNumber || 'ไม่ระบุ';
      const buildingName = room?.building?.name || undefined;

      const rentVal = snapshot?.resolvedRent ?? ctx.contract?.rentAmount;
      const rentAmountStr = formatRate(rentVal);

      const depositVal = snapshot?.resolvedDeposit ?? ctx.contract?.depositAmount;
      const depositAmountStr = formatRate(depositVal);

      const waterVal = snapshot ? snapshot.resolvedWaterRate : null;
      const waterRateStr = formatRate(waterVal);

      const elecVal = snapshot ? snapshot.resolvedElectricityRate : null;
      const electricityRateStr = formatRate(elecVal);

      const commonVal = snapshot ? snapshot.resolvedCommonFee : null;
      const commonFeeStr = formatRate(commonVal);

      const internetVal = snapshot ? snapshot.resolvedInternetFee : null;
      const internetFeeStr = formatRate(internetVal);

      const parkingVal = snapshot ? snapshot.resolvedParkingFee : null;
      const parkingFeeStr = formatRate(parkingVal);

      const snapData = snapshot?.snapshotData as any;
      const rawBillingDay = snapData?.billingDay?.value !== undefined && snapData?.billingDay?.value !== null
        ? snapData.billingDay.value
        : snapData?.billingDay !== undefined && snapData?.billingDay !== null
          ? snapData.billingDay
          : null;

      const rawDueDay = snapData?.dueDay?.value !== undefined && snapData?.dueDay?.value !== null
        ? snapData.dueDay.value
        : snapData?.dueDay !== undefined && snapData?.dueDay !== null
          ? snapData.dueDay
          : null;

      const billingDayVal = (rawBillingDay !== null && rawBillingDay !== undefined && rawBillingDay !== '')
        ? rawBillingDay
        : 'ไม่ระบุ';

      const dueDayVal = (rawDueDay !== null && rawDueDay !== undefined && rawDueDay !== '')
        ? rawDueDay
        : 'ไม่ระบุ';

      const createdAtStr = ctx.contract.createdAt
        ? ctx.contract.createdAt.toISOString().split('T')[0]
        : (ctx.contract.startDate ? ctx.contract.startDate.toISOString().split('T')[0] : 'ไม่ระบุ');

      const fullDormAddress = [
        dorm?.addressLine1,
        dorm?.addressLine2,
        dorm?.subdistrict ? `ต.${dorm.subdistrict}` : '',
        dorm?.district ? `อ.${dorm.district}` : '',
        dorm?.province ? `จ.${dorm.province}` : '',
        dorm?.postalCode
      ].filter(Boolean).join(' ') || dorm?.addressLine1 || undefined;

      const ownerMember = dorm?.members?.[0];
      const ownerNameFromMember = ownerMember?.user?.name;
      const rawBankName = dorm?.billingSettings?.bankAccountName?.trim() || dorm?.billingSettings?.promptPayAccountName?.trim() || null;
      const ownerDisplayName = ownerNameFromMember
        ? `${ownerNameFromMember} (${dorm?.name || 'หอพัก'})`
        : (rawBankName ? `${rawBankName} (${dorm?.name || 'หอพัก'})` : (dorm?.name || 'เจ้าของหอพัก'));

      const coTenantsList = await prisma.tenantCoOccupant.findMany({
        where: { tenantId: ctx.tenant.id, dormitoryId: ctx.dormitoryId, status: 'active' },
        select: { name: true, phone: true },
      });
      const coTenants = coTenantsList.map((c) => ({ name: c.name, phone: c.phone || undefined }));

      let ownerSignatureUrl: string | null = null;
      let tenantSignatureUrl: string | null = null;
      const sigStorage = new SignatureStorageService(prisma);

      if (ctx.contract.ownerSignature) {
        if (ctx.contract.ownerSignature.startsWith('data:image/') || ctx.contract.ownerSignature.startsWith('http')) {
          ownerSignatureUrl = ctx.contract.ownerSignature;
        } else {
          try {
            const stream = await sigStorage.getSignatureStream(ctx.contract.ownerSignature);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            ownerSignatureUrl = `data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`;
          } catch {}
        }
      } else if (dorm?.ownerSignatures?.[0]) {
        try {
          const stream = await sigStorage.getSignatureStream(dorm.ownerSignatures[0].objectKey);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          ownerSignatureUrl = `data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`;
        } catch {}
      }

      if (ctx.contract.tenantSignature) {
        if (ctx.contract.tenantSignature.startsWith('data:image/') || ctx.contract.tenantSignature.startsWith('http')) {
          tenantSignatureUrl = ctx.contract.tenantSignature;
        } else {
          try {
            const stream = await sigStorage.getSignatureStream(ctx.contract.tenantSignature);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            tenantSignatureUrl = `data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`;
          } catch {}
        }
      }

      const resolvedTerms = ctx.contract.terms?.trim() || dorm?.propertyDefaults?.defaultTerms?.trim() || undefined;

      const pdfService = new DocumentPdfService();
      const pdfBuffer = await pdfService.generateContractPdf({
        contractNumber: ctx.contract.contractNumber,
        dormitoryName: dorm?.name || 'หอพัก',
        dormitoryAddress: fullDormAddress,
        dormitoryPhone: dorm?.phone || undefined,
        ownerName: ownerDisplayName,
        ownerSignatureUrl,
        tenantName: ctx.tenant.displayName || `${ctx.tenant.firstName} ${ctx.tenant.lastName}`.trim(),
        tenantPhone: ctx.tenant.phone,
        tenantCitizenId: ctx.tenant.citizenId,
        coTenants,
        buildingName,
        roomNumber: resolvedRoomNumber,
        floor: room?.floor,
        rentBillingType: ctx.contract.rentBillingType === 'term' ? 'term' : 'monthly',
        startDate: ctx.contract.startDate ? ctx.contract.startDate.toISOString().split('T')[0] : 'ไม่ระบุ',
        endDate: ctx.contract.endDate ? ctx.contract.endDate.toISOString().split('T')[0] : 'ไม่ระบุ',
        durationMonths: ctx.contract.durationMonths,
        rentAmount: rentAmountStr,
        depositAmount: depositAmountStr,
        depositType: ctx.contract.depositType,
        advancePaymentAmount: ctx.contract.advancePaymentAmount ? Number(ctx.contract.advancePaymentAmount) : undefined,
        waterRate: waterRateStr,
        electricityRate: electricityRateStr,
        commonFee: commonFeeStr,
        internetFee: internetFeeStr,
        parkingFee: parkingFeeStr,
        billingDay: billingDayVal,
        dueDay: dueDayVal,
        terms: resolvedTerms,
        tenantSignature: tenantSignatureUrl,
        createdAt: createdAtStr,
      });

      const isDownload = req.query.download === 'true' || req.query.download === '1';
      const dispositionType = isDownload ? 'attachment' : 'inline';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${dispositionType}; filename="Contract-${ctx.contract.contractNumber}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // GET /api/v1/tenant-portal/id-card
  router.get('/id-card', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const tenant = ctx.tenant;
      const dorm = await prisma.dormitory.findUnique({
        where: { id: ctx.dormitoryId },
      });

      const pdfService = new DocumentPdfService();
      const pdfBuffer = await pdfService.generateIdCardPdf({
        tenantName: tenant.displayName || `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim(),
        citizenId: tenant.citizenId || tenant.nationalIdMasked || 'ไม่ระบุ',
        phone: tenant.phone,
        email: tenant.email,
        roomNumber: ctx.contract?.room?.roomNumber || 'ไม่ระบุ',
        dormitoryName: dorm?.name || 'หอพัก',
        photoUrl: tenant.photoUrl,
      });

      const isDownload = req.query.download === 'true' || req.query.download === '1';
      const dispositionType = isDownload ? 'attachment' : 'inline';
      const safeId = (tenant.citizenId || tenant.id.slice(0, 8)).replace(/[^a-zA-Z0-9_-]/g, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${dispositionType}; filename="IDCard-${safeId}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // GET /api/v1/tenant-portal/id-card-photo
  router.get('/id-card-photo', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }
      const tenant = ctx.tenant;
      const isDownload = req.query.download === 'true' || req.query.download === '1';
      const safeName = (tenant.displayName || `${tenant.firstName || ''}_${tenant.lastName || ''}`.trim() || tenant.id.slice(0, 8)).replace(/[^a-zA-Z0-9_\u0E00-\u0E7F-]/g, '_');

      if (tenant.idCardObjectKey) {
        const localStorageProvider = new LocalStorageProvider();
        const fileBuffer = await localStorageProvider.getFile(tenant.idCardObjectKey);
        const isPdf = tenant.idCardMimeType === 'application/pdf' || tenant.idCardObjectKey.endsWith('.pdf');
        const isPng = tenant.idCardMimeType === 'image/png' || tenant.idCardObjectKey.endsWith('.png');
        const isWebp = tenant.idCardMimeType === 'image/webp' || tenant.idCardObjectKey.endsWith('.webp');
        const ext = isPdf ? '.pdf' : (isPng ? '.png' : (isWebp ? '.webp' : '.jpg'));
        const contentType = isPdf ? 'application/pdf' : (tenant.idCardMimeType || (isPng ? 'image/png' : 'image/jpeg'));
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        if (isDownload) {
          res.setHeader('Content-Disposition', `attachment; filename="IDCard-${encodeURIComponent(safeName)}${ext}"`);
        } else {
          res.setHeader('Content-Disposition', 'inline');
        }
        return res.send(fileBuffer);
      }
      if (tenant.photoUrl) {
        return res.redirect(tenant.photoUrl);
      }
      return res.status(404).json({ error: { code: 'NO_ID_CARD', message: 'ผู้เช่ายังไม่ได้อัปโหลดเอกสารสำเนาบัตรประชาชน' } });
    } catch (err: any) {
      return res.status(404).json({ error: { code: 'ID_CARD_NOT_FOUND', message: err.message || 'ไม่พบรูปถ่ายสำเนาบัตรประชาชน' } });
    }
  });

  // POST /api/v1/tenant-portal/id-card-photo
  router.post('/id-card-photo', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      let buffer: Buffer | null = null;
      if (req.body?.image && typeof req.body.image === 'string') {
        const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
      }

      if (!buffer) {
        return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'กรุณาเลือกไฟล์ภาพสำเนาบัตรประชาชน' } });
      }

      const storage = new LocalStorageProvider();
      const objectKey = `tenants/${ctx.dormitoryId}/${ctx.tenant.id}/id-card-${Date.now()}.jpg`;
      await storage.saveFile(objectKey, buffer);

      const uploadedAt = new Date();
      await prisma.tenant.update({
        where: { id: ctx.tenant.id },
        data: {
          idCardObjectKey: objectKey,
          idCardMimeType: 'image/jpeg',
          idCardByteSize: buffer.length,
          idCardUploadedAt: uploadedAt,
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          hasIdentityDocument: true,
          photoUrl: '/api/v1/tenant-portal/id-card-photo',
          idCardUploadedAt: uploadedAt.toISOString()
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // GET /api/v1/tenant-portal/contract/signatures/tenant
  router.get('/contract/signatures/tenant', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }
      if (!ctx.contract || !ctx.contract.tenantSignature) {
        return res.status(404).json({ error: { message: 'Tenant signature not found' } });
      }
      if (ctx.contract.tenantSignature.startsWith('data:') || ctx.contract.tenantSignature.startsWith('http')) {
        return res.redirect(ctx.contract.tenantSignature);
      }
      const signatureService = new SignatureStorageService(prisma);
      const stream = await signatureService.getSignatureStream(ctx.contract.tenantSignature);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.pipe(res);
    } catch (err: any) {
      return res.status(err.statusCode || 404).json({ error: { message: err.message || 'Signature not found' } });
    }
  });

  // GET /api/v1/tenant-portal/contract/signatures/owner
  router.get('/contract/signatures/owner', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }
      if (!ctx.contract) {
        return res.status(404).json({ error: { message: 'Contract not found' } });
      }
      const signatureService = new SignatureStorageService(prisma);
      let objectKey = ctx.contract.ownerSignature;
      if (!objectKey) {
        const latestOwnerSig = await signatureService.getLatestSignatureRecord(ctx.dormitoryId);
        objectKey = latestOwnerSig?.objectKey || null;
      }
      if (!objectKey) {
        return res.status(404).json({ error: { message: 'Owner signature not found' } });
      }
      if (objectKey.startsWith('data:') || objectKey.startsWith('http')) {
        return res.redirect(objectKey);
      }
      const stream = await signatureService.getSignatureStream(objectKey);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.pipe(res);
    } catch (err: any) {
      return res.status(err.statusCode || 404).json({ error: { message: err.message || 'Signature not found' } });
    }
  });

  // GET /api/v1/tenant-portal/rules
  router.get('/rules', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      const dorm = await prisma.dormitory.findUnique({
        where: { id: ctx.dormitoryId },
      });
      const dormName = dorm?.name || 'หอพักสุขสบาย';
      const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>กฎระเบียบและข้อบังคับอาคาร - ${dormName}</title>
  <style>
    body { font-family: 'Tahoma', 'Leelawadee UI', sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; max-width: 800px; margin: 0 auto; background-color: #ffffff; }
    h1 { color: #1e1b4b; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; font-size: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .rules-list { margin-top: 20px; }
    .rule-item { margin-bottom: 16px; padding: 14px 18px; background: #f8fafc; border-left: 4px solid #4f46e5; border-radius: 8px; }
    .rule-title { font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 14px; }
    .rule-desc { font-size: 13px; color: #475569; margin: 0; }
    .print-btn { background: #4f46e5; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; float: right; font-size: 12px; font-weight: bold; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">พิมพ์ / บันทึกเอกสาร</button>
  <div class="header">
    <h1>กฎระเบียบและข้อบังคับการพักอาศัย</h1>
    <p style="font-size: 14px; color: #64748b;"><strong>${dormName}</strong></p>
  </div>
  <div class="rules-list">
    <div class="rule-item">
      <div class="rule-title">1. ความสงบเรียบร้อยและการใช้เสียง</div>
      <p class="rule-desc">ห้ามส่งเสียงดังยามวิกาลหลังเวลา 22:00 น. เพื่อไม่ให้รบกวนผู้พักอาศัยห้องอื่น</p>
    </div>
    <div class="rule-item">
      <div class="rule-title">2. การรักษาความสะอาด</div>
      <p class="rule-desc">ห้ามวางขยะ รองเท้า หรือสิ่งของกีดขวางบริเวณทางเดินส่วนกลางและบันไดหนีไฟเด็ดขาด</p>
    </div>
    <div class="rule-item">
      <div class="rule-title">3. ข้อห้ามเรื่องการสูบบุหรี่และสารเสพติด</div>
      <p class="rule-desc">ห้ามสูบบุหรี่ หรือบุหรี่ไฟฟ้า ภายในห้องพัก ระเบียง และพื้นที่ส่วนกลางทั้งหมด</p>
    </div>
    <div class="rule-item">
      <div class="rule-title">4. นโยบายการเลี้ยงสัตว์</div>
      <p class="rule-desc">การนำสัตว์เลี้ยงเข้าพักต้องเป็นไปตามเงื่อนไขและได้รับอนุญาตจากทางหอพักเป็นลายลักษณ์อักษรเท่านั้น</p>
    </div>
    <div class="rule-item">
      <div class="rule-title">5. การดัดแปลงห้องพัก</div>
      <p class="rule-desc">ห้ามดัดแปลง ต่อเติม ทาสี หรือเจาะผนังอาคารโดยไม่ได้รับอนุมัติจากผู้จัดการหอพัก</p>
    </div>
    <div class="rule-item">
      <div class="rule-title">6. การชำระเงินค่าเช่าและค่าสาธารณูปโภค</div>
      <p class="rule-desc">ผู้เช่าต้องชำระค่าเช่าและค่าบริการภายในวันที่กำหนดในสัญญาเช่าของแต่ละเดือน</p>
    </div>
  </div>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (err: any) {
      return res.status(500).send('Error loading rules');
    }
  });

  // GET /api/v1/tenant-portal/notices (Persistent in-app tenant notices)
  router.get('/notices', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      if (ctx.isCandidate || !/^[0-9a-fA-F-]{36}$/.test(ctx.tenant.id)) {
        return res.json({ data: [] });
      }

      const notices = await prisma.tenantNotice.findMany({
        where: { dormitoryId: ctx.dormitoryId, tenantId: ctx.tenant.id },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ data: notices });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // POST /api/v1/tenant-portal/notices/:id/read
  router.post('/notices/:id/read', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const notice = await prisma.tenantNotice.findFirst({
        where: { id: req.params.id, dormitoryId: ctx.dormitoryId, tenantId: ctx.tenant.id },
      });

      if (!notice) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบรายการแจ้งเตือนที่ระบุ', requestId: req.requestId } });
      }

      const updated = await prisma.tenantNotice.update({
        where: { id: req.params.id },
        data: { isRead: true, readAt: new Date() },
      });

      return res.json({ data: updated });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // POST /api/v1/tenant-portal/notices/read-all
  router.post('/notices/read-all', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const resUpdate = await prisma.tenantNotice.updateMany({
        where: { dormitoryId: ctx.dormitoryId, tenantId: ctx.tenant.id, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });

      return res.json({ data: { markedCount: resUpdate.count } });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // 12. Tenant Co-Occupants List
  router.get('/co-occupants', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const coOccupants = await prisma.tenantCoOccupant.findMany({
        where: { dormitoryId: ctx.dormitoryId, tenantId: ctx.tenant.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      const householdCount = 1 + coOccupants.length;

      return res.json({
        success: true,
        data: coOccupants.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone || '',
          relationship: c.relationship || '',
          createdAt: c.createdAt.toISOString(),
        })),
        peopleCount: householdCount,
      });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // 13. Tenant Co-Occupant Add (Self-Service)
  router.post('/co-occupants', async (req: Request, res: Response) => {
    // Canonical CSRF verification
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.['horplus_csrf'];
    const requestId = (req.headers['x-request-id'] as string) || req.requestId || 'req-unknown';

    if (!csrfHeader) {
      return res.status(403).json({
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'ไม่พบ CSRF token ในคำขอ (X-CSRF-Token header missing)',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const sessionId = req.auth?.sessionId;
    if (!sessionId) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'ไม่พบข้อมูลเซสชันสำหรับตรวจสอบ CSRF token',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (authService) {
      const isValid = authService.verifyCsrf(csrfHeader, sessionId);
      if (!isValid || (csrfCookie && csrfCookie !== csrfHeader)) {
        return res.status(403).json({
          error: {
            code: 'CSRF_TOKEN_INVALID',
            message: 'CSRF token ไม่ถูกต้องหรือไม่สัมพันธ์กับเซสชันปัจจุบัน',
            fieldErrors: null,
            requestId,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'ไม่พบข้อมูลผู้ใช้ที่เข้าสู่ระบบ', requestId },
      });
    }

    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId } });
      }

      const parsed = CreateCoOccupantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลผู้พักร่วมไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId,
          },
        });
      }

      const result = await billingOrchestrationService.addTenantCoOccupant(
        ctx.dormitoryId,
        ctx.tenant.id,
        parsed.data,
        { userId: actorUserId, isTenant: true }
      );

      return res.status(201).json({
        success: true,
        data: {
          id: result.coOccupant.id,
          name: result.coOccupant.name,
          phone: result.coOccupant.phone || '',
          relationship: result.coOccupant.relationship || '',
          createdAt: result.coOccupant.createdAt.toISOString(),
        },
        peopleCount: result.peopleCount,
        prevPeopleCount: result.prevPeopleCount,
        recalculation: result.recalculation,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
      const message = statusCode >= 500 ? 'เกิดข้อผิดพลาดภายในระบบ' : (err.message || 'เกิดข้อผิดพลาด');
      return res.status(statusCode).json({
        error: { code, message, requestId },
      });
    }
  });

  // 14. Tenant Co-Occupant Delete (Self-Service)
  router.delete('/co-occupants/:id', async (req: Request, res: Response) => {
    // Canonical CSRF verification
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.['horplus_csrf'];
    const requestId = (req.headers['x-request-id'] as string) || req.requestId || 'req-unknown';

    if (!csrfHeader) {
      return res.status(403).json({
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'ไม่พบ CSRF token ในคำขอ (X-CSRF-Token header missing)',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const sessionId = req.auth?.sessionId;
    if (!sessionId) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'ไม่พบข้อมูลเซสชันสำหรับตรวจสอบ CSRF token',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (authService) {
      const isValid = authService.verifyCsrf(csrfHeader, sessionId);
      if (!isValid || (csrfCookie && csrfCookie !== csrfHeader)) {
        return res.status(403).json({
          error: {
            code: 'CSRF_TOKEN_INVALID',
            message: 'CSRF token ไม่ถูกต้องหรือไม่สัมพันธ์กับเซสชันปัจจุบัน',
            fieldErrors: null,
            requestId,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'ไม่พบข้อมูลผู้ใช้ที่เข้าสู่ระบบ', requestId },
      });
    }

    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId } });
      }

      // Assert co-occupant ownership for the requesting tenant
      const coOccupant = await prisma.tenantCoOccupant.findFirst({
        where: {
          id: req.params.id,
          tenantId: ctx.tenant.id,
          dormitoryId: ctx.dormitoryId,
          deletedAt: null,
        },
      });

      if (!coOccupant) {
        return res.status(404).json({
          error: {
            code: 'CO_OCCUPANT_NOT_FOUND',
            message: 'ไม่พบข้อมูลผู้พักร่วมที่ระบุ',
            requestId,
          },
        });
      }

      const result = await billingOrchestrationService.removeTenantCoOccupant(
        ctx.dormitoryId,
        ctx.tenant.id,
        req.params.id,
        { userId: actorUserId, isTenant: true }
      );

      return res.json({
        success: true,
        message: 'ลบผู้พักอาศัยร่วมเรียบร้อยแล้ว',
        removedId: result.removedId,
        peopleCount: result.peopleCount,
        prevPeopleCount: result.prevPeopleCount,
        recalculation: result.recalculation,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
      const message = statusCode >= 500 ? 'เกิดข้อผิดพลาดภายในระบบ' : (err.message || 'เกิดข้อผิดพลาด');
      return res.status(statusCode).json({
        error: { code, message, requestId },
      });
    }
  });

  return router;
}
