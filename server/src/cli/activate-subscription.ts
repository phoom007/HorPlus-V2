import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';

export async function runOperationalActivationCli(argv: string[] = process.argv.slice(2)) {
  const dormId = argv[0];
  const durationMonths = parseInt(argv[1] || '1', 10);
  const actorId = argv[2] || 'cli-operator';
  const idempotencyKey = argv[3] || `cli-activate-${Date.now()}`;
  const reason = argv[4] || 'CLI operational activation';

  if (!dormId) {
    console.error('Usage: npx tsx src/cli/activate-subscription.ts <dormitoryId> [durationMonths] [actorId] [idempotencyKey] [reason]');
    process.exit(1);
  }

  try {
    const result = await subscriptionEntitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId,
      durationMonths,
      actorId,
      idempotencyKey,
      reason,
    });
    console.log('Operational Paid subscription activated successfully:', {
      dormitoryId: result.dormitoryId,
      planId: result.planId,
      status: result.status,
      expiresAt: result.expiresAt,
    });
    return result;
  } catch (err: any) {
    console.error('CLI Activation Error:', err.message || err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('activate-subscription')) {
  runOperationalActivationCli();
}
