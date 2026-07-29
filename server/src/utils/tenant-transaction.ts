import { PrismaClient } from '@prisma/client';

export interface TenantTransactionContext {
  dormitoryId: string;
  tenantId: string;
  contractId: string;
  lineIdentityId: string;
}

export async function withTenantLineTransaction<T>(
  prisma: PrismaClient,
  context: TenantTransactionContext,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Set local RLS transaction parameters in live PostgreSQL environment
    await tx.$executeRawUnsafe(`SET LOCAL app.current_dormitory_id = '${context.dormitoryId.replace(/'/g, "''")}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${context.tenantId.replace(/'/g, "''")}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.current_contract_id = '${context.contractId.replace(/'/g, "''")}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.current_line_identity_id = '${context.lineIdentityId.replace(/'/g, "''")}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.current_access_type = 'tenant'`);

    return fn(tx as PrismaClient);
  });
}
