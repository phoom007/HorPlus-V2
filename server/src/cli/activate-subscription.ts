import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';

export async function runOperationalActivationCli(argv: string[] = process.argv.slice(2)) {
  const dormId = argv[0];
  const durationMonthsStr = argv[1];
  const actorId = argv[2];
  const idempotencyKey = argv[3];
  const reason = argv[4];

  if (!dormId || !durationMonthsStr || !actorId || !idempotencyKey || !reason) {
    console.error('ERROR: All parameters are required.');
    console.error('Usage: npx tsx src/cli/activate-subscription.ts <dormitoryId> <durationMonths> <actorId> <idempotencyKey> <reason>');
    process.exit(1);
  }

  const durationMonths = parseInt(durationMonthsStr, 10);
  if (isNaN(durationMonths) || durationMonths <= 0) {
    console.error('ERROR: durationMonths must be a positive integer.');
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
