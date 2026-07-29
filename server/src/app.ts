import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getEnv } from './config/env.js';
import { cookieParserMiddleware } from './middleware/cookie-parser.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLoggerMiddleware } from './middleware/request-logger.js';
import { notFoundMiddleware } from './middleware/not-found.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { extractUnifiedActor } from './middleware/unified-actor.middleware.js';
import { createApiRouter, AppApiDependencies } from './routes/index.js';
import { incrementMetricsRequestCount, decrementMetricsActiveRequests } from './services/health.service.js';

import { ProductionGoogleIdentityVerifier, MockGoogleIdentityVerifier } from './services/google-verifier.service.js';
import { AuthenticationService } from './services/auth.service.js';
import { InMemoryUserRepository } from './db/repositories/user.repository.js';
import { InMemorySessionRepository } from './db/repositories/session.repository.js';
import { InMemoryMembershipRepository } from './db/repositories/membership.repository.js';
import { InMemoryRoleRepository } from './db/repositories/role.repository.js';
import { InMemoryDormitoryRepository } from './db/repositories/dormitory.repository.js';
import { InMemoryBillingSettingsRepository } from './db/repositories/billing-settings.repository.js';
import { InMemoryPaymentSettingsRepository } from './db/repositories/payment-settings.repository.js';
import { InMemoryPlanRepository } from './db/repositories/plan.repository.js';
import { InMemorySubscriptionRepository } from './db/repositories/subscription.repository.js';
import { InMemoryPromoRepository } from './db/repositories/promo.repository.js';
import { InMemoryOnboardingDraftRepository } from './db/repositories/onboarding-draft.repository.js';
import { InMemoryIdempotencyRepository } from './db/repositories/idempotency.repository.js';
import { InMemoryBuildingRepository } from './db/repositories/building.repository.js';
import { InMemoryRoomRepository } from './db/repositories/room.repository.js';
import { InMemoryTenantRepository } from './db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from './db/repositories/contract.repository.js';
import { InMemoryBillingCycleRepository } from './db/repositories/billing-cycle.repository.js';
import { InMemoryMeterRepository } from './db/repositories/meter.repository.js';
import { InMemoryBillRepository } from './db/repositories/bill.repository.js';
import { InMemoryPaymentRepository } from './db/repositories/payment.repository.js';
import { InMemoryReceiptRepository } from './db/repositories/receipt.repository.js';

import { SensitiveFieldService } from './services/sensitive-field.service.js';
import { PlanService } from './services/plan.service.js';
import { PromoService } from './services/promo.service.js';
import { OnboardingService } from './services/onboarding.service.js';
import { DormitoryProvisioningService } from './services/dormitory-provisioning.service.js';
import { BuildingService } from './services/building.service.js';
import { RoomService } from './services/room.service.js';
import { TenantService } from './services/tenant.service.js';
import { ContractService } from './services/contract.service.js';
import { OccupancyService } from './services/occupancy.service.js';
import { BillingCycleService } from './services/billing-cycle.service.js';
import { MeterService } from './services/meter.service.js';
import { BillingService } from './services/billing.service.js';
import { InMemoryPaymentEvidenceStorage } from './services/storage-provider.service.js';
import { MockSlipVerificationProvider } from './services/slip-verifier.service.js';
import { ReceiptGenerationService } from './services/receipt.service.js';
import { PaymentService } from './services/payment.service.js';
import { auditService } from './services/audit.service.js';

export function createApp(customAuthService?: AuthenticationService): Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');

  if (env.TRUST_PROXY) {
    app.set('trust proxy', true);
  }

  // Repositories
  const userRepo = new InMemoryUserRepository();
  const sessionRepo = new InMemorySessionRepository();
  const membershipRepo = new InMemoryMembershipRepository();
  const roleRepo = new InMemoryRoleRepository();
  const dormitoryRepo = new InMemoryDormitoryRepository();
  const billingRepo = new InMemoryBillingSettingsRepository();
  const paymentRepo = new InMemoryPaymentSettingsRepository();
  const planRepo = new InMemoryPlanRepository();
  const subRepo = new InMemorySubscriptionRepository();
  const promoRepo = new InMemoryPromoRepository();
  const draftRepo = new InMemoryOnboardingDraftRepository();
  const idempotencyRepo = new InMemoryIdempotencyRepository();
  const buildingRepo = new InMemoryBuildingRepository();
  const roomRepo = new InMemoryRoomRepository();
  const tenantRepo = new InMemoryTenantRepository();
  const contractRepo = new InMemoryContractRepository();
  const billingCycleRepo = new InMemoryBillingCycleRepository();
  const meterRepo = new InMemoryMeterRepository();
  const billRepo = new InMemoryBillRepository();
  const paymentRecordRepo = new InMemoryPaymentRepository();
  const receiptRepo = new InMemoryReceiptRepository();

  // Storage & Verification Providers
  const storageProvider = new InMemoryPaymentEvidenceStorage();
  const verificationProvider = new MockSlipVerificationProvider('valid');

  // Services
  const sensitiveFieldService = new SensitiveFieldService(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEY_VERSION);
  const planService = new PlanService(planRepo);
  const promoService = new PromoService(promoRepo);
  const onboardingService = new OnboardingService(draftRepo, membershipRepo, dormitoryRepo, subRepo, planRepo);
  const buildingService = new BuildingService(buildingRepo, roomRepo, auditService);
  const roomService = new RoomService(roomRepo, buildingRepo, subRepo, planRepo, contractRepo, auditService);
  const tenantService = new TenantService(tenantRepo, contractRepo, sensitiveFieldService, auditService);
  const contractService = new ContractService(contractRepo, roomRepo, tenantRepo, auditService);
  const occupancyService = new OccupancyService(roomRepo, buildingRepo, tenantRepo, contractRepo);
  const billingCycleService = new BillingCycleService(billingCycleRepo, auditService);
  const meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, auditService);
  const billingService = new BillingService(billRepo, billingCycleRepo, meterRepo, contractRepo, roomRepo, tenantRepo, auditService);
  const receiptService = new ReceiptGenerationService(receiptRepo, billRepo, dormitoryRepo, tenantRepo, roomRepo);
  const paymentService = new PaymentService(paymentRecordRepo, billRepo, storageProvider, verificationProvider, receiptService, auditService);

  const isTestEnv = env.NODE_ENV === 'test' || process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const verifier = isTestEnv
    ? new MockGoogleIdentityVerifier()
    : new ProductionGoogleIdentityVerifier(env.GOOGLE_CLIENT_ID);

  const authService = customAuthService || new AuthenticationService(
    env,
    verifier,
    userRepo,
    sessionRepo,
    membershipRepo,
    roleRepo,
    auditService
  );

  const provisioningService = new DormitoryProvisioningService(
    dormitoryRepo,
    billingRepo,
    paymentRepo,
    planRepo,
    subRepo,
    promoRepo,
    membershipRepo,
    roleRepo,
    draftRepo,
    idempotencyRepo,
    sensitiveFieldService,
    promoService,
    auditService
  );

  const apiDeps: AppApiDependencies = {
    authService,
    onboardingService,
    planService,
    promoService,
    provisioningService,
    sensitiveFieldService,
    buildingService,
    roomService,
    tenantService,
    contractService,
    occupancyService,
    billingCycleService,
    meterService,
    billingService,
    paymentService,
    receiptService,
    dormitoryRepo,
    billingRepo,
    paymentRepo,
    receiptRepo,
    subRepo,
    planRepo,
    membershipRepo,
    roleRepo,
  };

  // Metrics counter tracking
  app.use((_req: Request, res: Response, next: NextFunction) => {
    incrementMetricsRequestCount();
    res.on('finish', () => {
      decrementMetricsActiveRequests();
    });
    next();
  });

  // Security headers & CORS
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
      },
      credentials: true,
    })
  );

  // Body & Cookie Parsing
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));
  app.use(cookieParserMiddleware);

  // Custom Request ID and Logging
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(extractUnifiedActor());

  // Health Routes
  app.use('/health', healthRouter);

  // API Routes
  const apiRouter = createApiRouter(apiDeps);
  app.use('/', apiRouter);
  app.use(env.API_BASE_PATH, apiRouter);

  // 404 and Global Error Handling
  app.use(notFoundMiddleware);
  app.use(globalErrorHandler);

  return app;
}
