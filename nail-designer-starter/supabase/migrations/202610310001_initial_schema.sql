-- Nail Designer / initial schema
-- Execute via Supabase CLI or SQL Editor. Review before production.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.app_role as enum ('owner', 'customer');
create type public.appointment_status as enum (
  'pending_payment', 'confirmed', 'in_progress', 'completed',
  'cancelled', 'expired', 'no_show'
);
create type public.payment_status as enum (
  'pending', 'paid', 'failed', 'refunded', 'partially_refunded'
);
create type public.payment_method as enum ('pix', 'cash', 'card', 'other');
create type public.cancellation_resolution as enum ('refund', 'credit', 'retain', 'pending_review');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Jéssica Souza Nail Designer',
  timezone text not null default 'America/Fortaleza',
  deposit_percent numeric(5,2) not null default 50 check (deposit_percent > 0 and deposit_percent <= 100),
  reservation_expiration_minutes integer not null default 30 check (reservation_expiration_minutes between 5 and 180),
  free_cancellation_hours integer not null default 24 check (free_cancellation_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  role public.app_role not null default 'customer',
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  image_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  check (end_time > start_time)
);

create table public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  service_id uuid not null references public.services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'pending_payment',
  service_name_snapshot text not null,
  service_price_snapshot numeric(12,2) not null check (service_price_snapshot >= 0),
  deposit_percent_snapshot numeric(5,2) not null check (deposit_percent_snapshot between 0 and 100),
  deposit_amount numeric(12,2) not null check (deposit_amount >= 0),
  remaining_amount numeric(12,2) not null check (remaining_amount >= 0),
  reservation_expires_at timestamptz,
  cancellation_requested_at timestamptz,
  cancellation_resolution public.cancellation_resolution,
  cancellation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (deposit_amount + remaining_amount = service_price_snapshot)
);

-- Prevent overlapping active appointments for the same business.
-- Temporary reservations and confirmed/in-progress appointments block the interval.
alter table public.appointments
  add constraint appointments_no_active_overlap
  exclude using gist (
    business_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('pending_payment', 'confirmed', 'in_progress'));

create index appointments_customer_starts_idx
  on public.appointments(customer_id, starts_at desc);
create index appointments_business_starts_idx
  on public.appointments(business_id, starts_at);
create index blocked_times_business_range_idx
  on public.blocked_times using gist (business_id, tstzrange(starts_at, ends_at, '[)'));

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null default 'pix',
  status public.payment_status not null default 'pending',
  provider text,
  provider_transaction_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  channel text not null default 'whatsapp',
  event_type text not null,
  status text not null default 'queued',
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Enable RLS. Policies are intentionally restrictive in the starter:
-- add owner/customer policies after establishing the business owner and
-- secure booking/payment RPCs. Never expose service-role credentials to the browser.
alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.business_hours enable row level security;
alter table public.blocked_times enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Public users can read active services; no public writes.
create policy "Public can read active services"
  on public.services for select
  using (active = true);

-- Authenticated customers can read and update only their own profile.
create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Customer can read only their own appointments.
create policy "Customers can read own appointments"
  on public.appointments for select to authenticated
  using (customer_id = auth.uid());

-- Customer can read payment records linked to their own appointments.
create policy "Customers can read own payments"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = payments.appointment_id
        and a.customer_id = auth.uid()
    )
  );

-- IMPORTANT:
-- Do not add client-side INSERT/UPDATE policies for appointments or payments.
-- Implement booking, expiration, cancellation and payment confirmation through
-- validated database functions / Edge Functions with authorization checks.
-- Owner policies must verify the caller is the owner of the matching business.
