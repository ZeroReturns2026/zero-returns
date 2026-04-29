/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { execScript, close } from '../src/db';

async function main() {
  // Support running from compiled dist/ or from source
  let migrationsDir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.resolve(__dirname, '../../migrations');
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  → Applying ${file}`);
    await execScript(sql);
    console.log(`  ✓ ${file} applied`);
  }

  await close();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
