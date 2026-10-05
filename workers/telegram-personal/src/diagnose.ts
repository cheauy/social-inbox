import pg from "pg";

/*
 * Read-only connection check for the worker's TELEGRAM_PERSONAL_DATABASE_URL.
 *   node --env-file=.env src/diagnose.ts
 * Prints which project/user the worker connects as and what it can see.
 * Never prints the password and never claims or changes any session.
 */
const url = process.env.TELEGRAM_PERSONAL_DATABASE_URL;
if (!url) {
  console.error("TELEGRAM_PERSONAL_DATABASE_URL is empty or .env was not loaded.");
  process.exit(1);
}

let target = "unparseable connection string";
try {
  const parsed = new URL(url);
  target = `user=${decodeURIComponent(parsed.username)} host=${parsed.hostname} port=${parsed.port || "5432"} db=${parsed.pathname.slice(1)}`;
} catch {
  /* reported below */
}
console.log("Connecting as:", target);

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  const { rows } = await client.query(`
    select current_user as db_user,
           (select count(*)::int from pg_proc where proname = 'tgp_claim_sessions') as has_claim_function,
           to_regclass('public.telegram_personal_sessions') is not null as has_sessions_table
  `);
  console.log(rows[0]);
  if (rows[0].has_sessions_table) {
    const waiting = await client.query(`
      select status, count(*)::int as n,
             count(*) filter (where lease_owner is null)::int as unclaimed
      from public.telegram_personal_sessions
      where ended_at is null
      group by status order by status
    `);
    console.log("Open sessions by status:", waiting.rows);
    const exec = await client.query(`select has_function_privilege('public.tgp_claim_sessions(text,integer,integer)', 'execute') as can_run_worker_functions`);
    console.log(exec.rows[0]);
  } else {
    console.log("This database has no Telegram Personal tables: the connection string points to a different project than where the schema was installed.");
  }
  await client.end();
} catch (error) {
  console.error("DB ERROR", error instanceof Error ? error.message : error);
  process.exit(1);
}
