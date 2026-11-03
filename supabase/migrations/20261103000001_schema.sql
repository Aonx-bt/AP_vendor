-- AP Desk schema. RLS is enabled with open policies for the demo (no auth).
create extension if not exists pgcrypto;

create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  gstin_status text not null default 'active' check (gstin_status in ('active','cancelled','not_found')),
  msme_status text,
  udyam_no text,
  bank_name text,
  bank_last4 text,
  ifsc text,
  bank_verified boolean not null default false,
  email_domain text,
  tds_section text,
  fy_taxable_total numeric(14,2) not null default 0,
  contact_email text,
  created_at timestamptz not null default now()
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  vendor_id uuid not null references vendors(id),
  amount numeric(14,2) not null,
  billed_amount numeric(14,2) not null default 0,
  tolerance_pct numeric(5,2) not null default 2
);

create table emails (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  source text not null default 'simulated' check (source in ('simulated','gmail')),
  from_address text not null,
  subject text not null default '',
  body_text text not null default '',
  received_at timestamptz not null default now(),
  in_reply_to text,
  thread_id text,
  attachments jsonb not null default '[]',
  attachment_hash text,
  classification text check (classification in ('invoice','credit_note','statement','quotation_or_proforma','auto_reply','newsletter','vendor_reply','other')),
  classification_reason text,
  flag text,
  processed boolean not null default false,
  bill_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index emails_attachment_hash_idx on emails(attachment_hash);

create table bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id),
  vendor_gstin text,
  bank_last4 text,
  ifsc text,
  invoice_no text,
  invoice_date date,
  due_date date,
  payment_terms text,
  subtotal numeric(14,2),
  discount numeric(14,2) not null default 0,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  tax_total numeric(14,2),
  total numeric(14,2),
  tds_section text,
  tds_pct numeric(5,2) not null default 0,
  status text not null default 'received' check (status in ('received','needs_vendor_info','needs_review','in_approval','approved','rejected','duplicate')),
  department text,
  narration text,
  po_id uuid references purchase_orders(id),
  po_reference text,
  rcm boolean not null default false,
  file_path text,
  file_name text,
  file_mime text,
  file_hash text,
  source_email_id uuid references emails(id),
  extracted jsonb,
  field_confidence jsonb,
  insights jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bills_vendor_idx on bills(vendor_id);
create index bills_status_idx on bills(status);
create index bills_file_hash_idx on bills(file_hash);

create table bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  position int not null default 1,
  description text,
  hsn_sac text,
  qty numeric(14,3),
  rate numeric(14,2),
  gst_pct numeric(5,2),
  amount_excl_gst numeric(14,2)
);
create index bill_lines_bill_idx on bill_lines(bill_id);

create table validation_results (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  check_key text not null,
  outcome text not null check (outcome in ('pass','warn','fail','skipped')),
  detail text not null,
  evidence jsonb not null default '{}',
  source text not null default 'computed' check (source in ('computed','simulated_registry')),
  created_at timestamptz not null default now()
);
create index validation_results_bill_idx on validation_results(bill_id);

create table approval_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority int not null default 10,
  conditions jsonb not null default '[]',
  levels jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  rule_id uuid references approval_rules(id) on delete set null,
  level int not null,
  approver_name text not null,
  approver_role text not null,
  status text not null check (status in ('waiting','pending','approved','rejected','changes_requested','cancelled')),
  comment text,
  pending_since timestamptz,
  acted_at timestamptz,
  created_at timestamptz not null default now()
);
create index approvals_bill_idx on approvals(bill_id);

create table trace_events (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid references bills(id) on delete cascade,
  email_id uuid references emails(id) on delete cascade,
  ts timestamptz not null default now(),
  actor text not null,
  action text not null,
  reasoning text not null default '',
  evidence jsonb not null default '{}'
);
create index trace_events_bill_idx on trace_events(bill_id, ts);

create table vendor_messages (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  to_address text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','sent')),
  simulated boolean not null default false,
  rfc_message_id text,
  thread_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Outstanding balance = sum of totals of approved, unpaid bills.
create or replace view vendor_ledger as
select
  v.id as vendor_id,
  coalesce(sum(b.total) filter (where b.status = 'approved' and b.paid_at is null), 0)::numeric(14,2) as outstanding_balance,
  min(b.due_date) filter (where b.paid_at is null and b.status not in ('rejected','duplicate')) as next_due_date,
  coalesce(sum(b.total) filter (where b.paid_at is null and b.status not in ('rejected','duplicate') and b.due_date < current_date), 0)::numeric(14,2) as overdue_amount,
  count(b.id) filter (where b.paid_at is null and b.status not in ('rejected','duplicate')) as open_bills
from vendors v
left join bills b on b.vendor_id = v.id
group by v.id;

-- Demo: open RLS
do $$
declare t text;
begin
  foreach t in array array['vendors','purchase_orders','emails','bills','bill_lines','validation_results','approval_rules','approvals','trace_events','vendor_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "demo open access" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Storage bucket for invoice files (public read for the demo viewer)
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', true) on conflict (id) do nothing;
create policy "demo invoices read" on storage.objects for select using (bucket_id = 'invoices');
create policy "demo invoices write" on storage.objects for insert with check (bucket_id = 'invoices');
create policy "demo invoices update" on storage.objects for update using (bucket_id = 'invoices');
create policy "demo invoices delete" on storage.objects for delete using (bucket_id = 'invoices');
