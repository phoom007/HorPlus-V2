export interface RLSContext {
  userId: string;
  dormitoryId: string;
}

export type TransactionCallback<T> = (tx: any) => Promise<T>;

/**
 * Helper to execute multi-tenant query operations inside a single PostgreSQL connection/transaction
 * with transaction-local context variables set for Row Level Security (RLS) enforcement.
 */
export async function withDormitoryTransaction<T>(
  prismaOrTx: any,
  context: RLSContext,
  callback: TransactionCallback<T>
): Promise<T> {
  const { userId, dormitoryId } = context;

  if (!userId || !dormitoryId) {
    throw new Error('RLS context requires both userId and dormitoryId');
  }

  // Validate ID format to prevent malicious input before SQL execution
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(userId) && !userId.startsWith('usr-')) {
    throw new Error('Invalid userId format for RLS context');
  }
  if (!uuidRegex.test(dormitoryId) && !dormitoryId.startsWith('dorm-')) {
    throw new Error('Invalid dormitoryId format for RLS context');
  }

  const runInsideTx = async (tx: any) => {
    // If $executeRaw is available on transaction instance, set transaction-local settings
    if (typeof tx.$executeRawUnsafe === 'function') {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId.replace(/'/g, "''")}';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_dormitory_id = '${dormitoryId.replace(/'/g, "''")}';`);
    }
    return callback(tx);
  };

  if (typeof prismaOrTx.$transaction === 'function') {
    return prismaOrTx.$transaction(runInsideTx);
  }

  // If already inside a transaction or mock object
  return runInsideTx(prismaOrTx);
}

/**
 * Helper to execute initial owner onboarding provisioning inside a user-scoped transaction
 * before a dormitory membership is created.
 */
export async function withUserProvisioningTransaction<T>(
  prismaOrTx: any,
  userId: string,
  callback: TransactionCallback<T>
): Promise<T> {
  if (!userId) {
    throw new Error('User provisioning transaction requires userId');
  }

  const runInsideTx = async (tx: any) => {
    if (typeof tx.$executeRawUnsafe === 'function') {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId.replace(/'/g, "''")}';`);
    }
    return callback(tx);
  };

  if (typeof prismaOrTx.$transaction === 'function') {
    return prismaOrTx.$transaction(runInsideTx);
  }

  return runInsideTx(prismaOrTx);
}
