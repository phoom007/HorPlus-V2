import express, { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
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
import { getPrismaClient } from './db/prisma.js';

import { ProductionGoogleIdentityVerifier, MockGoogleIdentityVerifier } from './services/google-verifier.service.js';
import { AuthenticationService } from './services/auth.service.js';
import { InMemoryUserRepository, PrismaUserRepository } from './db/repositories/user.repository.js';
import { InMemorySessionRepository, PrismaSessionRepository } from './db/repositories/session.repository.js';
import { InMemoryMembershipRepository, PrismaMembershipRepository } from './db/repositories/membership.repository.js';
import { InMemoryRoleRepository, PrismaRoleRepository } from './db/repositories/role.repository.js';
import { InMemoryDormitoryRepository, PrismaDormitoryRepository } from './db/repositories/dormitory.repository.js';
import { InMemoryBillingSettingsRepository, PrismaBillingSettingsRepository } from './db/repositories/billing-settings.repository.js';
import { InMemoryPlanRepository } from './db/repositories/plan.repository.js';
import { InMemorySubscriptionRepository, PrismaSubscriptionRepository } from './db/repositories/subscription.repository.js';
import { EntitlementService } from './services/entitlement.service.js';
import { InMemoryPromoRepository } from './db/repositories/promo.repository.js';
import { InMemoryOnboardingDraftRepository } from './db/repositories/onboarding-draft.repository.js';
import { InMemoryIdempotencyRepository } from './db/repositories/idempotency.repository.js';
import { InMemoryBuildingRepository, PrismaBuildingRepository } from './db/repositories/building.repository.js';
import { InMemoryRoomRepository, PrismaRoomRepository } from './db/repositories/room.repository.js';
import { InMemoryTenantRepository, PrismaTenantRepository } from './db/repositories/tenant.repository.js';
import { InMemoryContractRepository, PrismaContractRepository } from './db/repositories/contract.repository.js';
import { InMemoryBillingCycleRepository, PrismaBillingCycleRepository } from './db/repositories/billing-cycle.repository.js';
import { InMemoryMeterRepository, PrismaMeterRepository } from './db/repositories/meter.repository.js';
import { InMemoryBillRepository, PrismaBillRepository } from './db/repositories/bill.repository.js';

import { SensitiveFieldService } from './services/sensitive-field.service.js';
import { MockLinePlatformAdapter } from './services/line-platform-adapter.js';
import { createLinePlatformAdapter } from './services/line-adapter-factory.js';
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
import { subscriptionEntitlementService } from './services/subscription-entitlement.service.js';
import { auditService } from './services/audit.service.js';

export interface CreateAppOptions {
  customAuthService?: AuthenticationService;
  customBillingCycleService?: BillingCycleService;
  /** When true, use Prisma repositories even in test mode (for integration tests). */
  forcePrisma?: boolean;
}

export function createApp(optionsOrAuth?: CreateAppOptions | AuthenticationService): Express {
  // Backwards compatibility: accept a bare AuthenticationService
  const options: CreateAppOptions = optionsOrAuth instanceof AuthenticationService
    ? { customAuthService: optionsOrAuth }
    : (optionsOrAuth ?? {});

  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.disable('etag');

  if (env.TRUST_PROXY) {
    app.set('trust proxy', true);
  }

  const isTestEnv = env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  
  // Property repository mode assertion
  // Force Prisma repository by default for normal development, production, and Playwright
  // Only use in-memory if explicitly requested via REPOSITORY_MODE env var
  const useInMemoryRepos = process.env.REPOSITORY_MODE === 'in-memory' && !options.forcePrisma;
  
  if (useInMemoryRepos) {
    console.warn('Property repository mode: IN_MEMORY (This must not be seen in production or browser tests)');
  } else {
    console.log('Property repository mode: PRISMA_POSTGRESQL');
  }

  // Repositories
  const prisma = useInMemoryRepos ? null : getPrismaClient();
  const userRepo = useInMemoryRepos ? new InMemoryUserRepository() : new PrismaUserRepository(prisma!);
  const sessionRepo = useInMemoryRepos ? new InMemorySessionRepository() : new PrismaSessionRepository(prisma!);
  const membershipRepo = useInMemoryRepos ? new InMemoryMembershipRepository() : new PrismaMembershipRepository(prisma!);
  const roleRepo = useInMemoryRepos ? new InMemoryRoleRepository() : new PrismaRoleRepository(prisma!);
  const dormitoryRepo = useInMemoryRepos ? new InMemoryDormitoryRepository() : new PrismaDormitoryRepository(prisma!);
  const billingRepo = useInMemoryRepos ? new InMemoryBillingSettingsRepository() : new PrismaBillingSettingsRepository(prisma!);
  const planRepo = new InMemoryPlanRepository();
  const subRepo = useInMemoryRepos ? new InMemorySubscriptionRepository() : new PrismaSubscriptionRepository(prisma!);
  const promoRepo = new InMemoryPromoRepository();
  const draftRepo = new InMemoryOnboardingDraftRepository();
  const idempotencyRepo = new InMemoryIdempotencyRepository();
  const buildingRepo = useInMemoryRepos ? new InMemoryBuildingRepository() : new PrismaBuildingRepository(prisma!);
  const roomRepo = useInMemoryRepos ? new InMemoryRoomRepository() : new PrismaRoomRepository(prisma!);
  const tenantRepo = useInMemoryRepos ? new InMemoryTenantRepository() : new PrismaTenantRepository(prisma!);
  const contractRepo = useInMemoryRepos ? new InMemoryContractRepository() : new PrismaContractRepository(prisma!);
  const billingCycleRepo = useInMemoryRepos ? new InMemoryBillingCycleRepository() : new PrismaBillingCycleRepository(prisma!);
  const meterRepo = useInMemoryRepos ? new InMemoryMeterRepository() : new PrismaMeterRepository(prisma!);
  const billRepo = useInMemoryRepos ? new InMemoryBillRepository() : new PrismaBillRepository(prisma!);

  // Storage & Verification Providers
    const verificationProvider = process.env.NODE_ENV === 'production'

  // Services
  const sensitiveFieldService = new SensitiveFieldService(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEY_VERSION);
  const entitlementService = new EntitlementService(subRepo, planRepo);
  const planService = new PlanService(planRepo);
  const promoService = new PromoService(promoRepo);
  const onboardingService = new OnboardingService(prisma!);
  const buildingService = new BuildingService(buildingRepo, roomRepo, auditService);
  const roomService = new RoomService(roomRepo, buildingRepo, subRepo, planRepo, contractRepo, auditService, entitlementService, prisma);
  const tenantService = new TenantService(tenantRepo, contractRepo, sensitiveFieldService, auditService, useInMemoryRepos ? undefined : (prisma ?? undefined));
  const contractService = new ContractService(contractRepo, roomRepo, tenantRepo, auditService);
  const occupancyService = new OccupancyService(roomRepo, buildingRepo, tenantRepo, contractRepo);
  const billingCycleService = options.customBillingCycleService || new BillingCycleService(billingCycleRepo, auditService);
  const meterService = new MeterService(meterRepo as any, billingCycleRepo, roomRepo, billRepo as any, auditService);
  const billingService = new BillingService(billRepo as any, billingCycleRepo, meterRepo as any, contractRepo, roomRepo, tenantRepo as any, auditService);

  const verifier = isTestEnv
    ? new MockGoogleIdentityVerifier()
    : new ProductionGoogleIdentityVerifier(env.GOOGLE_CLIENT_ID);

  const authService = options.customAuthService || new AuthenticationService(
    env,
    verifier,
    userRepo,
    sessionRepo,
    membershipRepo,
    roleRepo,
    auditService
  );

  const provisioningService = new DormitoryProvisioningService(prisma!, sensitiveFieldService);

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
    lineAdapter: (process.env.NODE_ENV === 'test' && process.env.HORPLUS_E2E !== 'true')
      ? new MockLinePlatformAdapter()
      : createLinePlatformAdapter(),
    dormitoryRepo,
    billingRepo,
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
  app.use(
    helmet({
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/client', 'https://accounts.google.com/gsi/'],
          'frame-src': ["'self'", 'https://accounts.google.com/gsi/'],
          'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style', 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https:', 'data:', 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'https://*.line-scdn.net', 'https://profile.line-scdn.net', 'https://obs.line-scdn.net', 'https://images.unsplash.com'],
        },
      },
    })
  );
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

  // Raw Body Parsing for LINE Webhook Signature Verification
  app.use('/api/v1/line/webhook', express.raw({ type: 'application/json' }));

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
  app.use(env.API_BASE_PATH, apiRouter);

  // Serve static assets in production mode (Single-Origin Pilot App)
  const clientDistPath = path.join(process.cwd(), 'client-dist');
  const serverPublicPath = path.join(process.cwd(), 'public');
  const parentDistPath = path.join(process.cwd(), '..', 'dist');

  const staticDir = fs.existsSync(clientDistPath)
    ? clientDistPath
    : fs.existsSync(serverPublicPath)
      ? serverPublicPath
      : fs.existsSync(parentDistPath)
        ? parentDistPath
        : null;

  if (staticDir) {
    app.use(express.static(staticDir));
  }

  // SPA Fallback for single-origin web frontend
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
      return res.sendFile(path.join(staticDir, 'index.html'));
    }
    next();
  });

  // 404 and Global Error Handling
  app.use(notFoundMiddleware);
  app.use(globalErrorHandler);

  return app;
}
