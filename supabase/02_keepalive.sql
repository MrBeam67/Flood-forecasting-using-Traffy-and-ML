-- Run in Supabase Dashboard -> SQL Editor AFTER the Render service is live.
-- 1) Replace YOUR-APP.onrender.com below with your Render URL.
-- 2) Run the whole file (safe to re-run; it replaces the existing job).
--
-- Every 10 minutes Supabase calls /api/health on Render. That
--   * keeps the Render free instance from sleeping (no ~1 min cold start), and
--   * runs `SELECT 1` against this database, so the free project is never
--     paused for inactivity.
-- One always-on free Render service uses ~744 h/month, inside the 750 h free quota.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

select cron.schedule(
  'keepalive-render',
  '*/10 * * * *',
  $$ select net.http_get(url := 'https://YOUR-APP.onrender.com/api/health', timeout_milliseconds := 60000) $$
);

-- Check it's running (status should be 200 after the first few minutes):
--   select status_code, created from net._http_response order by created desc limit 5;
-- Stop it:
--   select cron.unschedule('keepalive-render');
