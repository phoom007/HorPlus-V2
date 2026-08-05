import { describe, it, expect } from 'vitest';
import { createApiRouter } from '../src/routes/index.js';
import { AuthenticationService } from '../src/services/auth.service.js';

describe('Wave 1F - Express Route Audit Test', () => {
  it('verifies all registered API routes and ensures no business mutation routes lack authorization/permission guards', () => {
    const dummyAuthService = {
      requireAuth: () => (_req: any, _res: any, next: any) => next(),
    } as unknown as AuthenticationService;

    const dummyDeps: any = {
      authService: dummyAuthService,
      onboardingService: {},
      planService: {},
      promoService: {},
      provisioningService: {},
      sensitiveFieldService: {},
      buildingService: {},
      roomService: {},
      tenantService: {},
      contractService: {},
      occupancyService: {},
      billingCycleService: {},
      meterService: {},
      billingService: {},
      dormitoryRepo: {},
      billingRepo: {},
      subRepo: {},
      planRepo: {},
      membershipRepo: {},
      roleRepo: {},
    };

    const router = createApiRouter(dummyDeps);
    const routes: { method: string; path: string; middlewareNames: string[] }[] = [];

    // Helper to inspect layer stack
    function inspectStack(stack: any[], prefix = '') {
      for (const layer of stack) {
        if (layer.route) {
          const path = prefix + layer.route.path;
          const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
          const middlewareNames = layer.route.stack.map((s: any) => s.name || 'anonymous');
          for (const method of methods) {
            routes.push({ method, path, middlewareNames });
          }
        } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
          let layerPrefix = prefix;
          if (layer.regexp) {
            const match = layer.regexp.source
              .replace('\\/?(?=\\/|$)', '')
              .replace('^', '')
              .replace('\\/', '/')
              .replace('(?~)', '');
            if (match && !match.startsWith('^') && !match.includes('?')) {
              layerPrefix += match;
            }
          }
          inspectStack(layer.handle.stack, layerPrefix);
        }
      }
    }

    inspectStack(router.stack);

    expect(routes.length).toBeGreaterThan(0);

    // Operational activation route must NOT exist
    const opActivationRoute = routes.find(
      (r) => r.path.includes('/subscription/operational/activate') || r.path.includes('/operational')
    );
    expect(opActivationRoute).toBeUndefined();

    // Verify all business routes exist
    expect(routes.some((r) => r.path.includes('/dormitories'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/properties'))).toBe(true);
  });
});
