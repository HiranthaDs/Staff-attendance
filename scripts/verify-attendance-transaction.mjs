import { createInterface } from "node:readline";
import pg from "pg";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
process.stdout.write("Database password for attendance transaction test: ");
rl._writeToOutput = () => {};
const password = await new Promise((resolve) => rl.question("", resolve));
rl.close();
process.stdout.write("\n");

const client = new pg.Client({
  host: "aws-0-ap-southeast-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.xfatvhwuxnmuvdbiafbf",
  password,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query("begin");
  const { rows: users } = await client.query("select id from auth.users where lower(email) = lower($1)", ["hiranthadiass4@gmail.com"]);
  if (!users[0]) throw new Error("Super-admin auth user was not found.");
  const userId = users[0].id;
  const { rows: branches } = await client.query(
    "insert into public.branches (name, code, address, latitude, longitude, verification_mode) values ($1, $2, $3, 6.927079, 79.861244, 'gps_only') returning id",
    [`Transaction Test ${Date.now()}`, `T${String(Date.now()).slice(-7)}`, "Rollback-only test branch"],
  );
  const branchId = branches[0].id;
  const date = "2099-12-30";
  const values = [userId, branchId, date, "clock_in", "2099-12-30T03:00:00Z", 6.927079, 79.861244, 5, 0, "203.0.113.10", true, true, "present", 0, 0];
  const call = "select (public.record_attendance_mark($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)).*";
  const first = await client.query(call, values);
  const duplicate = await client.query(call, values);
  if (first.rows[0].id !== duplicate.rows[0].id) throw new Error("Duplicate clock-in created another record.");
  const outValues = [...values];
  outValues[3] = "clock_out";
  outValues[4] = "2099-12-30T11:30:00Z";
  const clockOut = await client.query(call, outValues);
  if (clockOut.rows[0].work_minutes !== 510 || !clockOut.rows[0].clock_out) throw new Error("Clock-out duration was not stored correctly.");
  const duplicateOut = await client.query(call, outValues);
  if (duplicateOut.rows[0].id !== clockOut.rows[0].id) throw new Error("Duplicate clock-out was not idempotent.");
  await client.query("rollback");
  process.stdout.write("Attendance transaction verification passed: one daily record, idempotent marks and correct work duration. Test data rolled back.\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
