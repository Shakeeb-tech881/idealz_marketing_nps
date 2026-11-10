// Regenerates supabase/setup_all_in_one.sql from supabase/migrations/*.sql.
// Usage: node scripts/build-setup-sql.mjs   (run after adding or editing a migration)
// Optional: node scripts/build-setup-sql.mjs <out-file> <only-migrations-before-this-name>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "supabase/setup_all_in_one.sql");
const [out = target, before] = process.argv.slice(2);
const current = readFileSync(target, "utf8");
const header = current.slice(0, current.indexOf("begin;"));
const dir = join(root, "supabase/migrations");
const bar = "-- " + "#".repeat(77);
let sql = header + "begin;\n\n";
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && (!before || f < before)).sort()) {
  sql += `\n${bar}\n-- ${f}\n${bar}\n\n` + readFileSync(join(dir, f), "utf8").replace(/\s+$/, "") + "\n";
}
sql += "\ncommit;\n\n-- Check: should return 2\n-- select count(*) from public.survey_templates;\n";
writeFileSync(out, sql);
console.log(`Wrote ${out}`);
