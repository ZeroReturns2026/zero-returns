/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { execScript, close } from '../src/db';

function main() {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  → Applying ${file}`);
    execScript(sql);
    console.log(`  ✓ ${file} applied`);
  }

  close();
  console.log('Migrations complete.');
}

try {
  main();
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
}
