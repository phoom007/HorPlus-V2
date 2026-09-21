import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const tables = await prisma.$queryRaw<any[]>`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying');
  `;

  console.log(`Checking ${tables.length} columns for 'conditioning'...`);
  for (const col of tables) {
    try {
      const res = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "${col.column_name}" FROM "${col.table_name}" WHERE "${col.column_name}" LIKE '%conditioning%' LIMIT 1`
      );
      if (res && res.length > 0) {
        console.log(`FOUND in table: ${col.table_name}, column: ${col.column_name}, value:`, res[0]);
      }
    } catch (e) {}
  }

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
