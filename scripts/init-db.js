const { Client } = require('pg');
const fs = require('fs');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres.tpxwrwxpdcwmiynjjquy:WHj-nY3-y63-7jg@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
  });

  try {
    await client.connect();
    console.log('Connected to Supabase via Pooler (6543)');
    const sql = fs.readFileSync('scripts/init-schema.sql', 'utf8');
    
    // Split by semicolons and filter out empty lines
    // Note: this is a simple splitter, actual SQL parser would be better, but Prisma's diff output usually works
    const queries = sql.split(';').map(q => q.trim()).filter(q => q.length > 0);
    
    for (const query of queries) {
      try {
        console.log(`Executing: ${query.substring(0, 50)}...`);
        await client.query(query);
      } catch (err) {
        // If it's "already exists", ignore
        if (err.code === '42P07' || err.code === '42710') {
           console.log('Table or index already exists, skipping...');
        } else if (err.message.includes('extension "vector" already exists')) {
           console.log('Extension already exists, skipping...');
        }
        else {
          console.error(`Error executing query: ${err.message}`);
          // Don't stop on extension errors as they might be pre-created by Supabase
        }
      }
    }
    console.log('Schema initialization complete!');
  } finally {
    await client.end();
  }
}

main().catch(console.error);
