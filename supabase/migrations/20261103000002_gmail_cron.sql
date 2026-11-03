-- Run sync-gmail every minute. Needs two Vault secrets, created once per project:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon key>', 'anon_key');
-- Without them the job runs but posts nowhere. sync-gmail itself exits quietly when Gmail secrets are missing.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ap-desk-sync-gmail',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-gmail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{"trigger":"cron"}'::jsonb
  );
  $$
);
