/* eslint-disable no-console */
import readline from 'readline';
import { close, query } from '../src/db';

/**
 * Minimal CLI for editing product measurements and reviewing closet reports.
 */
async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => new Promise<string>((res) => rl.question('> ', res));

  console.log('Hey Tailor admin CLI. Type "help" for commands, "quit" to exit.');
  while (true) {
    const raw = (await prompt()).trim();
    if (!raw) continue;

    const args = tokenize(raw);
    const cmd = args.shift() ?? '';

    if (cmd === 'quit' || cmd === 'exit') break;

    if (cmd === 'help') {
      console.log('  list');
      console.log('  show <productId>');
      console.log('  set <productId> <size> <chest> <shoulder> <length>');
      console.log('  reports [limit]');
      console.log('  promote "<brand>" "<product>" <size> <item_type> <chest> <shoulder> <length>');
      console.log('  quit');
      continue;
    }

    if (cmd === 'list') {
      const rows = await query<any>(`SELECT id, title, handle FROM products ORDER BY id`);
      rows.forEach((r) => console.log(`  ${r.id}  ${r.title} (${r.handle})`));
      continue;
    }

    if (cmd === 'show') {
      const id = Number(args[0]);
      const rows = await query<any>(
        `SELECT id, size_label, chest_inches, shoulder_inches, length_inches
         FROM product_sizes WHERE product_id = $1 ORDER BY id`,
        [id]
      );
      if (rows.length === 0) {
        console.log(`  (no sizes for product ${id})`);
      } else {
        rows.forEach((r: any) =>
          console.log(`  ${r.size_label.padEnd(4)} chest=${r.chest_inches}  shoulder=${r.shoulder_inches}  length=${r.length_inches}`)
        );
      }
      continue;
    }

    if (cmd === 'set') {
      const [pid, size, chest, shoulder, length] = args;
      if (!pid || !size || !chest || !shoulder || !length) {
        console.log('  usage: set <productId> <size> <chest> <shoulder> <length>');
        continue;
      }
      await query(
        `UPDATE product_sizes SET chest_inches=$1, shoulder_inches=$2, length_inches=$3
         WHERE product_id=$4 AND size_label=$5`,
        [chest, shoulder, length, pid, size]
      );
      console.log('  ✓ updated');
      continue;
    }

    if (cmd === 'reports') {
      const limit = Number(args[0]) || 20;
      const rows = await query<any>(
        `SELECT cr.brand, cr.product_name, cr.size_label,
                COUNT(*) AS reports,
                SUM(CASE WHEN cr.fit_rating = 'perfect'   THEN 1 ELSE 0 END) AS perfect,
                SUM(CASE WHEN cr.fit_rating = 'too_small' THEN 1 ELSE 0 END) AS small,
                SUM(CASE WHEN cr.fit_rating = 'too_big'   THEN 1 ELSE 0 END) AS big,
                CASE WHEN EXISTS (
                  SELECT 1 FROM external_reference_items eri
                  WHERE lower(eri.brand) = lower(cr.brand)
                    AND lower(eri.product_name) = lower(cr.product_name)
                    AND lower(eri.size_label) = lower(cr.size_label)
                ) THEN 1 ELSE 0 END AS measured
           FROM closet_reports cr
           GROUP BY cr.brand, cr.product_name, cr.size_label
           ORDER BY reports DESC, cr.brand, cr.product_name
           LIMIT $1`,
        [limit]
      );

      if (rows.length === 0) {
        console.log('  (no closet reports yet — run `npm run sync` first)');
      } else {
        console.log('  reports  fit(p/s/b)   measured?  brand / product / size');
        rows.forEach((r: any) => {
          const fit = `${r.perfect}/${r.small}/${r.big}`;
          const m = r.measured ? '  ✓      ' : '          ';
          console.log(
            `  ${String(r.reports).padStart(5)}   ${fit.padEnd(10)} ${m} ${r.brand} — ${r.product_name} (${r.size_label})`
          );
        });
      }
      continue;
    }

    if (cmd === 'promote') {
      const [brand, product, size, itemType, chest, shoulder, length] = args;
      if (!brand || !product || !size || !itemType || !chest || !shoulder || !length) {
        console.log('  usage: promote "<brand>" "<product>" <size> <item_type> <chest> <shoulder> <length>');
        continue;
      }
      await query(
        `INSERT INTO external_reference_items
          (brand, product_name, item_type, size_label, chest_inches, shoulder_inches, length_inches)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [brand, product, itemType, size, Number(chest), Number(shoulder), Number(length)]
      );

      const matched = await query<any>(
        `SELECT COUNT(*) as n FROM closet_reports
          WHERE lower(brand) = lower($1)
            AND lower(product_name) = lower($2)
            AND lower(size_label) = lower($3)`,
        [brand, product, size]
      );

      console.log(
        `  ✓ promoted "${brand} — ${product} (${size})" as ${itemType}. ` +
          `${matched[0]?.n || 0} closet report(s) now back this reference.`
      );
      continue;
    }

    console.log(`Unknown command: ${cmd}`);
  }

  rl.close();
  await close();
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && /\s/.test(c)) {
      if (cur.length) { out.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur.length) out.push(cur);
  return out;
}

main().catch((err) => { console.error(err); process.exit(1); });
