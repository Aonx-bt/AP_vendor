-- One row per pass of the AP agent over a bill's document (upload, email, re-read, sample data).
create table extraction_runs (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  email_id uuid references emails(id) on delete set null,
  source text not null default 'upload' check (source in ('upload','email','reset','seed')),
  file_name text,
  engine text,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  outcome text,
  error text,
  started_at timestamptz not null default now(),
  read_started_at timestamptz,
  read_finished_at timestamptz,
  finished_at timestamptz,
  fields_found int,
  low_confidence jsonb not null default '[]',
  details jsonb not null default '{}'
);
create index extraction_runs_bill_idx on extraction_runs(bill_id, started_at desc);
create index extraction_runs_started_idx on extraction_runs(started_at desc);

alter table extraction_runs enable row level security;
create policy "demo open access" on extraction_runs for all using (true) with check (true);
