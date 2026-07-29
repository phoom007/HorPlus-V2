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
import { createPaymentRouter } from './payment.routes.js';
import { createPaymentEvidenceRouter } from './payment-evidence.routes.js';
import { createReceiptRouter } from './receipt.routes.js';
import { lineIntegrationRouter } from './line-integration.routes.js';
import { lineWebhookRouter } from './line-webhook.routes.js';
import { staffRoleRouter } from './staff-role.routes.js';
import { tenantRegistrationRouter } from './tenant-registration.routes.js';
import { liffSessionRouter } from './liff-session.routes.js';
import { lineQuotaRouter } from './line-quota.routes.js';
import { createTenantPortalRouter } from './tenant-portal.routes.js';
import { createMaintenanceRouter } from './maintenance.routes.ts';
import { createAnnouncementRouter } from './announcement.routes.ts';
import { createNotificationRouter, createTenantNotificationRouter } from './notification.routes.ts';
import { BuildingService } from '../services/building.service.js';
import { RoomService } from '../services/room.service.js';
import { TenantService } from '../services/tenant.service.js';
import { ContractService } from '../services/contract.service.js';
import { OccupancyService } from '../services/occupancy.service.js';
import { BillingCycleService } from '../services/billing-cycle.service.js';
import { MeterService } from '../services/meter.service.js';
import { BillingService } from '../services/billing.service.js';
import { PaymentService } from '../services/payment.service.js';
import { ReceiptGenerationService } from '../services/receipt.service.js';

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
  paymentService?: PaymentService;
  receiptService?: ReceiptGenerationService;
  dormitoryRepo: any;
  billingRepo: any;
  paymentRepo: any;
  receiptRepo?: any;
  subRepo: any;
  planRepo: any;
  membershipRepo: any;
  roleRepo: any;
}

export function createApiRouter(deps: AppApiDependencies | AuthenticationService): Router {
  const router = Router();

  // Support backwards compatibility if only authService passed
  const isDeps = typeof (deps as any).authService !== 'undefined';
  const authService = isDeps ? (deps as AppApiDependencies).authService : (deps as AuthenticationService);

  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      service: 'horplus-api',
      version: '0.1.0',
      status: 'foundation',
    });
  });

  router.use('/auth', createAuthRouter(authService));
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
    router.use(
      '/dormitories',
      createDormitoryRouter(
        fullDeps.authService,
        fullDeps.dormitoryRepo,
        fullDeps.billingRepo,
        fullDeps.paymentRepo,
        fullDeps.subRepo,
        fullDeps.planRepo,
        fullDeps.sensitiveFieldService,
        fullDeps.membershipRepo,
        fullDeps.roleRepo
      )
    );
    if (fullDeps.buildingService && fullDeps.roomService) {
      router.use('/properties', createPropertyRouter(fullDeps.authService, fullDeps.buildingService, fullDeps.roomService));
    }
    if (fullDeps.tenantService) {
      router.use('/tenants', createTenantRouter(fullDeps.authService, fullDeps.tenantService));
    }
    if (fullDeps.contractService) {
      router.use('/contracts', createContractRouter(fullDeps.authService, fullDeps.contractService));
    }
    if (fullDeps.occupancyService) {
      router.use('/occupancy', createOccupancyRouter(fullDeps.authService, fullDeps.occupancyService));
    }
    if (fullDeps.billingCycleService) {
      router.use('/billing-cycles', createBillingCycleRouter(fullDeps.authService, fullDeps.billingCycleService));
    }
    if (fullDeps.meterService) {
      router.use('/meters', createMeterRouter(fullDeps.authService, fullDeps.meterService));
    }
    if (fullDeps.billingService) {
      router.use('/bills', createBillingRouter(fullDeps.authService, fullDeps.billingService));
    }
    if (fullDeps.paymentService) {
      router.use('/payments', createPaymentRouter(fullDeps.authService, fullDeps.paymentService));
      router.use('/payment-evidence', createPaymentEvidenceRouter(fullDeps.authService, fullDeps.paymentService));
    }
    if (fullDeps.receiptService) {
      router.use('/receipts', createReceiptRouter(fullDeps.authService, fullDeps.receiptService));
    }

    // LINE OA, Staff Role, Tenant Registration & LIFF Session routes
    router.use('/', lineIntegrationRouter);
    router.use('/', lineWebhookRouter);
    router.use('/', staffRoleRouter);
    router.use('/', tenantRegistrationRouter);
    router.use('/', liffSessionRouter);
    router.use('/', lineQuotaRouter);
    router.use('/maintenance-requests', createMaintenanceRouter());
    router.use('/announcements', createAnnouncementRouter());
    router.use('/notifications', createNotificationRouter());
    router.use('/tenant/notifications', createTenantNotificationRouter());
    router.use('/tenant', createTenantPortalRouter());
  }

  return router;
}
