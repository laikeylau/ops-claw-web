const lbug = require('C:/Users/Len/AppData/Roaming/npm/node_modules/gitnexus/node_modules/@ladybugdb/core');

async function run() {
  const db = new lbug.Database('.gitnexus/lbug');
  const conn = new lbug.Connection(db);
  console.log('DB created');

  console.log('Step 1: LOAD EXTENSION fts...');
  try {
    await conn.query('LOAD EXTENSION fts');
    console.log('LOAD EXTENSION fts done');
  } catch(e) {
    console.log('LOAD EXTENSION fts error (may be OK):', e.message);
  }

  console.log('Step 2: INSTALL fts...');
  try {
    await conn.query('INSTALL fts');
    console.log('INSTALL fts done');
  } catch(e) {
    console.log('INSTALL fts error:', e.message);
  }

  console.log('Step 3: LOAD EXTENSION fts (after install)...');
  try {
    await conn.query('LOAD EXTENSION fts');
    console.log('LOAD EXTENSION fts done');
  } catch(e) {
    console.log('LOAD EXTENSION fts error:', e.message);
  }

  console.log('Cleanup...');
  db.close();
  console.log('All done!');
  process.exit(0);
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
