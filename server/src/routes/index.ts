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
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { BuildingService } from '../services/building.service.js';
import { RoomService } from '../services/room.service.js';
import { TenantService } from '../services/tenant.service.js';
import { ContractService } from '../services/contract.service.js';
import { OccupancyService } from '../services/occupancy.service.js';
import { BillingCycleService } from '../services/billing-cycle.service.js';
import { MeterService } from '../services/meter.service.js';
import { BillingService } from '../services/billing.service.js';

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

    // Business Router Middleware Stack (requireSession -> requireDormitoryWriteEntitlement)
    const bizAuthStack = [authService.requireAuth(), requireDormitoryWriteEntitlement];

    router.use(
      '/dormitories',
      bizAuthStack,
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
    if (fullDeps.buildingService && fullDeps.roomService) {
      router.use('/properties', bizAuthStack, createPropertyRouter(fullDeps.authService, fullDeps.buildingService, fullDeps.roomService));
    }
    if (fullDeps.tenantService) {
      router.use('/tenants', bizAuthStack, createTenantRouter(fullDeps.authService, fullDeps.tenantService));
    }
    if (fullDeps.contractService) {
      router.use('/contracts', bizAuthStack, createContractRouter(fullDeps.authService, fullDeps.contractService));
    }
    if (fullDeps.occupancyService) {
      router.use('/occupancy', bizAuthStack, createOccupancyRouter(fullDeps.authService, fullDeps.occupancyService));
    }
    if (fullDeps.billingCycleService) {
      router.use('/billing-cycles', bizAuthStack, createBillingCycleRouter(fullDeps.authService, fullDeps.billingCycleService));
    }
    if (fullDeps.meterService) {
      router.use('/meters', bizAuthStack, createMeterRouter(fullDeps.authService, fullDeps.meterService));
    }
    if (fullDeps.billingService) {
      router.use('/bills', bizAuthStack, createBillingRouter(fullDeps.authService, fullDeps.billingService));
    }

    router.use('/move-out', bizAuthStack, moveOutRouter);
    router.use('/maintenance-requests', bizAuthStack, createMaintenanceRouter());
    router.use('/maintenance', bizAuthStack, createMaintenanceRouter());
    router.use('/announcements', bizAuthStack, createAnnouncementRouter());
    router.use('/payments', bizAuthStack, createPaymentRouter(fullDeps.authService));
    router.use('/receipts', bizAuthStack, createReceiptRouter(fullDeps.authService));
    router.use('/notifications', bizAuthStack, createNotificationRouter());
    router.use('/tenant/notifications', bizAuthStack, createTenantNotificationRouter());
    router.use('/tenant-portal', bizAuthStack, createTenantPortalRouter(fullDeps.authService));
  }

  return router;
}
