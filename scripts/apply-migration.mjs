import { readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import pg from "pg";

let password = process.env.SUPABASE_DB_PASSWORD?.trim();
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write("Supabase database password: ");
  rl._writeToOutput = () => {};
  password = await new Promise((resolve) => rl.question("", resolve));
  rl.close();
  process.stdout.write("\n");
}
if (!password) throw new Error("SUPABASE_DB_PASSWORD is empty.");

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST || "aws-0-ap-southeast-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: "postgres",
  user: process.env.SUPABASE_DB_USER || "postgres.xfatvhwuxnmuvdbiafbf",
  password,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const migrations = await Promise.all(
    migrationFiles.map(async (file) => ({ file, sql: await readFile(new URL(file, migrationDirectory), "utf8") })),
  );
  await client.connect();
  await client.query("begin");
  for (const migration of migrations) {
    process.stdout.write(`Applying ${migration.file}...\n`);
    await client.query(migration.sql);
  }
  await client.query("commit");
  process.stdout.write(`\n${migrations.length} migration(s) applied successfully.\n`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  process.stderr.write(`\nMigration failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
