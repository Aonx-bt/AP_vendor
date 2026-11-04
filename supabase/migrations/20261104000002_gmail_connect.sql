-- Gmail connection.
-- 1. Server-only key/value store for the Gmail permission (refresh token), OAuth state and last sync time.
--    RLS is ON with NO policies: the website's public key cannot read or write it; only Edge Functions
--    (service role) can.
create table if not exists app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table app_secrets enable row level security;

-- 2. Lets the gmail-oauth function switch on the every-minute timer by storing this project's address in Vault.
create or replace function public.ap_set_project_url(url text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = 'project_url';
  if existing is null then
    perform vault.create_secret(url, 'project_url');
  else
    perform vault.update_secret(existing, url);
  end if;
end;
$$;
revoke all on function public.ap_set_project_url(text) from public, anon, authenticated;
grant execute on function public.ap_set_project_url(text) to service_role;

-- 3. Re-create the timer: sync-gmail needs no key (verify_jwt = false), only the project address.
--    It stays idle until Gmail is connected (project_url set).
select cron.unschedule('ap-desk-sync-gmail') where exists (select 1 from cron.job where jobname = 'ap-desk-sync-gmail');
select cron.schedule(
  'ap-desk-sync-gmail',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-gmail',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'project_url');
  $$
);
