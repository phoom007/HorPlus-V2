const { Client } = require('pg');

async function createTestDb() {
  const dbName = process.env.TEST_DB_NAME || 'horplus_wave1d_fasttrack_test';
  
  if (!process.env.PG_ADMIN_URL) {
    console.error("ERROR: PG_ADMIN_URL must be set (e.g. postgres://postgres:pass@localhost:5432/postgres)");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.PG_ADMIN_URL });
  
  try {
    await client.connect();
    
    // Check if db exists
    const res = await client.query('SELECT datname FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rows.length === 0) {
      console.log(`Creating database ${dbName}...`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log('Database created.');
    } else {
      console.log(`Database ${dbName} already exists. Cleaning up...`);
      await client.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log('Database recreated.');
    }
  } catch (err) {
    console.error('Error creating database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createTestDb();
