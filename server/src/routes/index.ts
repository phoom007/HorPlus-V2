import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { OnboardingService } from '../services/onboarding.service.js';
import { PlanService } from '../services/plan.service.js';
import { PromoService } from '../services/promo.service.js';
import { DormitoryProvisioningService } from '../services/dormitory-provisioning.service.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { createAuthRouter } from './auth.routes.js';
import { createUserRouter } from './user.routes.js';
import { createPublicRouter } from './public.routes.js';
import { createOnboardingRouter } from './onboarding.routes.js';
import { createDormitoryRouter } from './dormitory.routes.js';
import { createPropertyRouter } from './property.routes.js';
import { createTenantRouter } from './tenant.routes.js';
import { createContractRouter } from './contract.routes.js';
import { createOccupancyRouter } from './occupancy.routes.js';
import { createBillingCycleRouter } from './billing-cycle.routes.js';
import { createMeterRouter } from './meter.routes.js';
import { createBillingRouter } from './billing.routes.js';
import { moveOutRouter } from './move-out.routes.js';
import { createMaintenanceRouter } from './maintenance.routes.js';
import { createAnnouncementRouter } from './announcement.routes.js';
import { createPaymentRouter } from './payment.routes.js';
import { createReceiptRouter } from './receipt.routes.js';
import { healthRouter } from './health.routes.js';
import { createNotificationRouter, createTenantNotificationRouter } from './notification.routes.js';
import { createTenantPortalRouter } from './tenant-portal.routes.js';
import { createSubscriptionRouter } from './subscription.routes.js';
import { createStaffRoutes } from './staff.routes.js';
import { createLineOaRoutes } from './line-oa.routes.js';
import { createLinePlatformAdapter } from '../services/line-adapter-factory.js';
import { getPrismaClient } from '../db/prisma.js';
import { resolveDormitoryContextMiddleware } from '../middleware/permission.js';
import { BuildingService } from '../services/building.service.js';
import { RoomService } from '../services/room.service.js';
import { TenantService } from '../services/tenant.service.js';
import { ContractService } from '../services/contract.service.js';
import { OccupancyService } from '../services/occupancy.service.js';
import { BillingCycleService } from '../services/billing-cycle.service.js';
import { MeterService } from '../services/meter.service.js';
import { BillingService } from '../services/billing.service.js';
import { LinePlatformAdapter } from '../services/line-platform-adapter.js';
import { ILineChannelTokenProvider, LineChannelTokenProvider, FakeLineTokenProvider } from '../services/line-channel-token-provider.js';
import { createRequireActiveDormitoryMiddleware } from '../middleware/require-dormitory.js';

export interface AppApiDependencies {
  authService: AuthenticationService;
  onboardingService: OnboardingService;
  planService: PlanService;
  promoService: PromoService;
  provisioningService: DormitoryProvisioningService;
  sensitiveFieldService: SensitiveFieldService;
  buildingService?: BuildingService;
  roomService?: RoomService;
  tenantService?: TenantService;
  contractService?: ContractService;
  occupancyService?: OccupancyService;
  billingCycleService?: BillingCycleService;
  meterService?: MeterService;
  billingService?: BillingService;
  lineAdapter?: LinePlatformAdapter;
  lineTokenProvider?: ILineChannelTokenProvider;
  dormitoryRepo: any;
  billingRepo: any;
  subRepo: any;
  planRepo: any;
  membershipRepo: any;
  roleRepo: any;
}

export function createApiRouter(deps: AppApiDependencies | AuthenticationService): Router {
  const router = Router();

  const isDeps = typeof (deps as any).authService !== 'undefined';
  const authService = isDeps ? (deps as AppApiDependencies).authService : (deps as AuthenticationService);

  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      service: 'horplus-api',
      version: '0.1.0',
      status: 'foundation',
    });
  });

  router.use('/health', healthRouter);

  router.use('/auth', createAuthRouter(authService));
  router.use('/subscription', createSubscriptionRouter(authService));
  router.use('/', createUserRouter(authService));

  const prisma = getPrismaClient();

  // TASK-009: Application LINE adapter composition root
  const lineAdapter = isDeps && (deps as AppApiDependencies).lineAdapter
    ? (deps as AppApiDependencies).lineAdapter!
    : createLinePlatformAdapter();

  const lineTokenProvider = isDeps && (deps as AppApiDependencies).lineTokenProvider
    ? (deps as AppApiDependencies).lineTokenProvider!
    : (process.env.NODE_ENV === 'test' && process.env.HORPLUS_E2E !== 'true'
        ? new FakeLineTokenProvider()
        : new LineChannelTokenProvider());

  const staffRoutes = createStaffRoutes(prisma, authService, lineAdapter);
  const lineOaRoutes = createLineOaRoutes(prisma, authService, lineAdapter, lineTokenProvider);
  router.use('/', staffRoutes.publicRouter);
  router.use('/', lineOaRoutes.publicRouter);

  if (isDeps) {
    const fullDeps = deps as AppApiDependencies;
    router.use('/public', createPublicRouter(fullDeps.planService));
    router.use(
      '/onboarding',
      createOnboardingRouter(
        fullDeps.authService,
        fullDeps.onboardingService,
        fullDeps.promoService,
        fullDeps.provisioningService
      )
    );
    router.use(
      '/dormitories',
      createDormitoryRouter(
        fullDeps.authService,
        fullDeps.dormitoryRepo,
        fullDeps.billingRepo,
        fullDeps.subRepo,
        fullDeps.planRepo,
        fullDeps.sensitiveFieldService,
        fullDeps.membershipRepo,
        fullDeps.roleRepo
      )
    );

    const requireSession = fullDeps.authService.requireAuth();
    const requireActiveDormitory = createRequireActiveDormitoryMiddleware(prisma);
    const protectedRouter = Router();
    protectedRouter.use(requireSession);
    protectedRouter.use(resolveDormitoryContextMiddleware);
    protectedRouter.use(requireActiveDormitory);

    if (fullDeps.buildingService && fullDeps.roomService) {
      protectedRouter.use('/properties', createPropertyRouter(fullDeps.authService, fullDeps.buildingService, fullDeps.roomService));
    }
    if (fullDeps.tenantService) {
      protectedRouter.use('/tenants', createTenantRouter(fullDeps.authService, fullDeps.tenantService));
    }
    if (fullDeps.contractService) {
      protectedRouter.use('/contracts', createContractRouter(fullDeps.authService, fullDeps.contractService));
    }
    if (fullDeps.occupancyService) {
      protectedRouter.use('/occupancy', createOccupancyRouter(fullDeps.authService, fullDeps.occupancyService));
      protectedRouter.use('/occupancies', createOccupancyRouter(fullDeps.authService, fullDeps.occupancyService));
    }
    if (fullDeps.billingCycleService) {
      protectedRouter.use('/billing-cycles', createBillingCycleRouter(fullDeps.authService, fullDeps.billingCycleService));
    }
    if (fullDeps.meterService) {
      protectedRouter.use('/meters', createMeterRouter(fullDeps.authService, fullDeps.meterService));
    }
    if (fullDeps.billingService) {
      protectedRouter.use('/bills', createBillingRouter(fullDeps.authService, fullDeps.billingService));
    }

    protectedRouter.use('/move-out', moveOutRouter);
    protectedRouter.use('/maintenance-requests', createMaintenanceRouter());
    protectedRouter.use('/maintenance', createMaintenanceRouter());
    protectedRouter.use('/announcements', createAnnouncementRouter());
    protectedRouter.use('/payments', createPaymentRouter(fullDeps.authService));
    protectedRouter.use('/receipts', createReceiptRouter(fullDeps.authService));
    protectedRouter.use('/notifications', createNotificationRouter(fullDeps.authService));

    router.use('/', protectedRouter);
    router.use('/', staffRoutes.protectedRouter);
    router.use('/', lineOaRoutes.protectedRouter);
    router.use('/tenant-portal', createTenantPortalRouter(fullDeps.authService));
    router.use('/tenant-notifications', createTenantNotificationRouter(fullDeps.authService));
  }

  return router;
}
