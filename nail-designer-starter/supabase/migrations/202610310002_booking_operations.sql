-- Booking and owner operations for the single-business MVP.

alter table public.businesses
  add column if not exists pix_key text,
  add column if not exists pix_holder text,
  add column if not exists whatsapp_phone text;

alter table public.payments
  add column if not exists refunded_amount numeric(12,2) not null default 0
  check (refunded_amount >= 0 and refunded_amount <= amount);

insert into public.businesses (name)
select 'Jéssica Souza Nail Designer'
where not exists (select 1 from public.businesses);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    'customer',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Cliente'),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.current_owner_business_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.business_id
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'owner'
    and p.business_id is not null
  limit 1
$$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.business_id = p_business_id
  )
$$;

revoke all on function public.current_owner_business_id() from public, anon;
revoke all on function public.is_business_owner(uuid) from public, anon;
grant execute on function public.current_owner_business_id() to authenticated;
grant execute on function public.is_business_owner(uuid) to authenticated;

-- Keep profile edits limited to contact fields; clients cannot change their role.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own contact details"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "Owners can read clients for their business"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.customer_id = profiles.id
        and public.is_business_owner(a.business_id)
    )
  );

create policy "Public can read business booking details"
  on public.businesses for select to anon, authenticated
  using (true);

create policy "Owners can update their business"
  on public.businesses for update to authenticated
  using (public.is_business_owner(id))
  with check (public.is_business_owner(id));

create policy "Owners manage their services"
  on public.services for all to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

create policy "Owners manage business hours"
  on public.business_hours for all to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

create policy "Owners manage blocked times"
  on public.blocked_times for all to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

create policy "Owners can read appointments for their business"
  on public.appointments for select to authenticated
  using (public.is_business_owner(business_id));

create policy "Owners can read payments for their business"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = payments.appointment_id
        and public.is_business_owner(a.business_id)
    )
  );

create policy "Customers and owners can read appointment notifications"
  on public.notifications for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = notifications.appointment_id
        and (a.customer_id = auth.uid() or public.is_business_owner(a.business_id))
    )
  );

create policy "Owners can read audit logs for their business"
  on public.audit_logs for select to authenticated
  using (public.is_business_owner(business_id));

grant select on public.businesses, public.services to anon, authenticated;
grant select on public.profiles, public.business_hours, public.blocked_times,
  public.appointments, public.payments, public.notifications, public.audit_logs
  to authenticated;
grant insert, update, delete on public.services, public.business_hours,
  public.blocked_times to authenticated;

create or replace function public.get_available_slots(p_service_id uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_duration integer;
  v_timezone text;
  v_local_today date;
begin
  select s.business_id, s.duration_minutes, b.timezone
  into v_business_id, v_duration, v_timezone
  from public.services s
  join public.businesses b on b.id = s.business_id
  where s.id = p_service_id and s.active;

  if not found then
    return;
  end if;

  v_local_today := (now() at time zone v_timezone)::date;
  if p_date < v_local_today or p_date > v_local_today + 90 then
    return;
  end if;

  return query
  select slot.local_start at time zone v_timezone,
         (slot.local_start + make_interval(mins => v_duration)) at time zone v_timezone
  from public.business_hours h
  cross join lateral generate_series(
    p_date + h.start_time,
    p_date + h.end_time - make_interval(mins => v_duration),
    interval '30 minutes'
  ) as slot(local_start)
  where h.business_id = v_business_id
    and h.weekday = extract(dow from p_date)::smallint
    and h.active
    and (slot.local_start at time zone v_timezone) > now()
    and not exists (
      select 1 from public.blocked_times bt
      where bt.business_id = v_business_id
        and bt.starts_at < ((slot.local_start + make_interval(mins => v_duration)) at time zone v_timezone)
        and bt.ends_at > (slot.local_start at time zone v_timezone)
    )
    and not exists (
      select 1 from public.appointments a
      where a.business_id = v_business_id
        and a.starts_at < ((slot.local_start + make_interval(mins => v_duration)) at time zone v_timezone)
        and a.ends_at > (slot.local_start at time zone v_timezone)
        and (
          a.status in ('confirmed', 'in_progress')
          or (a.status = 'pending_payment' and a.reservation_expires_at > now())
        )
    )
  order by slot.local_start;
end;
$$;

create or replace function public.create_appointment(p_service_id uuid, p_starts_at timestamptz)
returns table (
  appointment_id uuid,
  service_name text,
  service_price numeric,
  deposit_amount numeric,
  remaining_amount numeric,
  reservation_expires_at timestamptz,
  pix_key text,
  pix_holder text,
  whatsapp_phone text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business public.businesses%rowtype;
  v_service public.services%rowtype;
  v_appointment_id uuid;
  v_deposit numeric(12,2);
  v_expiration timestamptz;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Faça login para reservar um horário.' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'Perfil de cliente não encontrado.' using errcode = 'P0001';
  end if;

  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.active;
  if not found then
    raise exception 'Este serviço não está disponível.' using errcode = 'P0001';
  end if;

  select b.* into v_business
  from public.businesses b
  where b.id = v_service.business_id;

  update public.appointments a
  set status = 'expired', updated_at = now()
  where a.business_id = v_service.business_id
    and a.status = 'pending_payment'
    and a.reservation_expires_at <= now();

  if not exists (
    select 1 from public.get_available_slots(
      p_service_id,
      (p_starts_at at time zone v_business.timezone)::date
    ) slot
    where slot.starts_at = p_starts_at
  ) then
    raise exception 'Este horário acabou de ficar indisponível.' using errcode = 'P0001';
  end if;

  v_deposit := round(v_service.price * v_business.deposit_percent / 100, 2);
  v_expiration := case when v_deposit > 0
    then now() + make_interval(mins => v_business.reservation_expiration_minutes)
    else null
  end;

  insert into public.appointments (
    business_id, customer_id, service_id, starts_at, ends_at, status,
    service_name_snapshot, service_price_snapshot, deposit_percent_snapshot,
    deposit_amount, remaining_amount, reservation_expires_at
  ) values (
    v_service.business_id, v_user_id, v_service.id, p_starts_at,
    p_starts_at + make_interval(mins => v_service.duration_minutes),
    case when v_deposit > 0 then 'pending_payment'::public.appointment_status
         else 'confirmed'::public.appointment_status end,
    v_service.name, v_service.price, v_business.deposit_percent,
    v_deposit, v_service.price - v_deposit, v_expiration
  ) returning id into v_appointment_id;

  if v_deposit > 0 then
    insert into public.payments (appointment_id, amount, method, status)
    values (v_appointment_id, v_deposit, 'pix', 'pending');
  end if;

  return query select v_appointment_id, v_service.name, v_service.price,
    v_deposit, v_service.price - v_deposit, v_expiration,
    v_business.pix_key, v_business.pix_holder, v_business.whatsapp_phone;
exception
  when exclusion_violation then
    raise exception 'Este horário acabou de ficar indisponível.' using errcode = 'P0001';
end;
$$;

create or replace function public.request_appointment_cancellation(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id and a.customer_id = auth.uid()
  for update;

  if not found then
    raise exception 'Agendamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_appointment.status not in ('pending_payment', 'confirmed') or v_appointment.starts_at <= now() then
    raise exception 'Este agendamento não pode mais ser cancelado pelo aplicativo.' using errcode = 'P0001';
  end if;

  if v_appointment.status = 'pending_payment' then
    update public.appointments
    set status = 'cancelled', cancellation_requested_at = now(),
        cancellation_resolution = 'pending_review', updated_at = now()
    where id = p_appointment_id;
  else
    update public.appointments
    set cancellation_requested_at = now(),
        cancellation_resolution = 'pending_review', updated_at = now()
    where id = p_appointment_id;
  end if;
end;
$$;

create or replace function public.owner_confirm_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_business_id uuid;
  v_payment_amount numeric(12,2);
begin
  select a.id, a.business_id, p.amount
  into v_appointment_id, v_business_id, v_payment_amount
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where p.id = p_payment_id
  for update of p, a;

  if not found or not public.is_business_owner(v_business_id) then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.id = v_appointment_id
      and a.status = 'pending_payment'
      and (a.reservation_expires_at is null or a.reservation_expires_at > now())
  ) then
    raise exception 'Este agendamento não está aguardando pagamento.' using errcode = 'P0001';
  end if;

  update public.payments
  set status = 'paid', paid_at = coalesce(paid_at, now())
  where id = p_payment_id and status = 'pending';
  if not found then
    raise exception 'Somente pagamentos pendentes podem ser confirmados.' using errcode = 'P0001';
  end if;

  update public.appointments
  set status = 'confirmed', reservation_expires_at = null, updated_at = now()
  where id = v_appointment_id and status = 'pending_payment';

  insert into public.audit_logs (actor_id, business_id, entity_type, entity_id, action, details)
  values (auth.uid(), v_business_id, 'payment', p_payment_id, 'manual_payment_confirmed',
    jsonb_build_object('amount', v_payment_amount, 'method', 'pix'));
end;
$$;

create or replace function public.owner_register_refund(p_payment_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_original_amount numeric(12,2);
  v_refunded_amount numeric(12,2);
begin
  if p_amount <= 0 then
    raise exception 'Informe um valor de reembolso maior que zero.' using errcode = '22023';
  end if;

  select a.business_id, p.amount, p.refunded_amount
  into v_business_id, v_original_amount, v_refunded_amount
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where p.id = p_payment_id
  for update of p;

  if not found or not public.is_business_owner(v_business_id) then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_original_amount < v_refunded_amount + p_amount then
    raise exception 'O reembolso ultrapassa o valor recebido.' using errcode = '22003';
  end if;

  update public.payments
  set refunded_amount = refunded_amount + p_amount,
      status = case when refunded_amount + p_amount = amount then 'refunded'::public.payment_status
                    else 'partially_refunded'::public.payment_status end
  where id = p_payment_id and status in ('paid', 'partially_refunded');
  if not found then
    raise exception 'Somente pagamentos recebidos podem ter reembolso registrado.' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (actor_id, business_id, entity_type, entity_id, action, details)
  values (auth.uid(), v_business_id, 'payment', p_payment_id, 'manual_refund_registered',
    jsonb_build_object('amount', p_amount));
end;
$$;

create or replace function public.owner_cancel_appointment(
  p_appointment_id uuid,
  p_resolution public.cancellation_resolution,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_business_id uuid;
begin
  if p_resolution = 'pending_review' then
    raise exception 'Escolha como resolver o sinal antes de concluir o cancelamento.' using errcode = '22023';
  end if;

  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and public.is_business_owner(a.business_id)
  for update;

  if not found then
    raise exception 'Agendamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_appointment.status not in ('pending_payment', 'confirmed') then
    raise exception 'Este agendamento não pode ser cancelado.' using errcode = 'P0001';
  end if;

  v_business_id := v_appointment.business_id;
  update public.appointments a
  set status = 'cancelled', cancellation_requested_at = coalesce(cancellation_requested_at, now()),
      cancellation_resolution = p_resolution, cancellation_notes = nullif(btrim(p_notes), ''), updated_at = now()
  where a.id = p_appointment_id;

  insert into public.audit_logs (actor_id, business_id, entity_type, entity_id, action, details)
  values (auth.uid(), v_business_id, 'appointment', p_appointment_id, 'appointment_cancelled',
    jsonb_build_object('resolution', p_resolution, 'notes', p_notes));
end;
$$;

create or replace function public.owner_update_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
begin
  if p_status not in ('in_progress', 'completed', 'no_show') then
    raise exception 'Status não permitido nesta operação.' using errcode = '22023';
  end if;

  update public.appointments a
  set status = p_status, updated_at = now()
  where a.id = p_appointment_id and a.status in ('confirmed', 'in_progress')
  returning a.business_id into v_business_id;

  if not found or not public.is_business_owner(v_business_id) then
    raise exception 'Agendamento não encontrado ou não pode ser alterado.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.owner_set_business_hours(
  p_weekday smallint,
  p_active boolean,
  p_start_time time default null,
  p_end_time time default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid := public.current_owner_business_id();
begin
  if v_business_id is null then
    raise exception 'Acesso exclusivo da proprietária.' using errcode = '42501';
  end if;
  if p_weekday not between 0 and 6 then
    raise exception 'Dia da semana inválido.' using errcode = '22023';
  end if;
  if p_active and (p_start_time is null or p_end_time is null or p_end_time <= p_start_time) then
    raise exception 'Informe um intervalo de horário válido.' using errcode = '22023';
  end if;

  delete from public.business_hours
  where business_id = v_business_id and weekday = p_weekday;

  if p_active then
    insert into public.business_hours (business_id, weekday, start_time, end_time, active)
    values (v_business_id, p_weekday, p_start_time, p_end_time, true);
  end if;
end;
$$;

create or replace function public.owner_update_business_contact(
  p_pix_key text,
  p_pix_holder text,
  p_whatsapp_phone text,
  p_deposit_percent numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid := public.current_owner_business_id();
begin
  if v_business_id is null then
    raise exception 'Acesso exclusivo da proprietária.' using errcode = '42501';
  end if;
  if p_deposit_percent <= 0 or p_deposit_percent > 100 then
    raise exception 'O percentual do sinal deve estar entre 0 e 100.' using errcode = '22023';
  end if;

  update public.businesses
  set pix_key = nullif(btrim(p_pix_key), ''),
      pix_holder = nullif(btrim(p_pix_holder), ''),
      whatsapp_phone = nullif(regexp_replace(coalesce(p_whatsapp_phone, ''), '\D', '', 'g'), ''),
      deposit_percent = p_deposit_percent,
      updated_at = now()
  where id = v_business_id;
end;
$$;

create or replace function public.owner_reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_timezone text;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  if not found or not public.is_business_owner(v_appointment.business_id) then
    raise exception 'Agendamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_appointment.status not in ('pending_payment', 'confirmed') then
    raise exception 'Este agendamento não pode ser remarcado.' using errcode = 'P0001';
  end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id = v_appointment.business_id;

  update public.appointments set status = 'cancelled' where id = p_appointment_id;

  if not exists (
    select 1 from public.get_available_slots(
      v_appointment.service_id,
      (p_starts_at at time zone v_timezone)::date
    ) slot where slot.starts_at = p_starts_at
  ) then
    raise exception 'O novo horário não está disponível.' using errcode = 'P0001';
  end if;

  update public.appointments
  set starts_at = p_starts_at,
      ends_at = p_starts_at + make_interval(mins => (
        select s.duration_minutes from public.services s where s.id = v_appointment.service_id
      )),
      status = v_appointment.status,
      updated_at = now()
  where id = p_appointment_id;

  insert into public.audit_logs (actor_id, business_id, entity_type, entity_id, action, details)
  values (auth.uid(), v_appointment.business_id, 'appointment', p_appointment_id, 'appointment_rescheduled',
    jsonb_build_object('previous_starts_at', v_appointment.starts_at, 'starts_at', p_starts_at));
end;
$$;

revoke all on function public.get_available_slots(uuid, date) from public;
revoke all on function public.create_appointment(uuid, timestamptz) from public, anon;
revoke all on function public.request_appointment_cancellation(uuid) from public, anon;
revoke all on function public.owner_confirm_payment(uuid) from public, anon;
revoke all on function public.owner_register_refund(uuid, numeric) from public, anon;
revoke all on function public.owner_cancel_appointment(uuid, public.cancellation_resolution, text) from public, anon;
revoke all on function public.owner_update_appointment_status(uuid, public.appointment_status) from public, anon;
revoke all on function public.owner_set_business_hours(smallint, boolean, time, time) from public, anon;
revoke all on function public.owner_update_business_contact(text, text, text, numeric) from public, anon;
revoke all on function public.owner_reschedule_appointment(uuid, timestamptz) from public, anon;

grant execute on function public.get_available_slots(uuid, date) to anon, authenticated;
grant execute on function public.create_appointment(uuid, timestamptz) to authenticated;
grant execute on function public.request_appointment_cancellation(uuid) to authenticated;
grant execute on function public.owner_confirm_payment(uuid) to authenticated;
grant execute on function public.owner_register_refund(uuid, numeric) to authenticated;
grant execute on function public.owner_cancel_appointment(uuid, public.cancellation_resolution, text) to authenticated;
grant execute on function public.owner_update_appointment_status(uuid, public.appointment_status) to authenticated;
grant execute on function public.owner_set_business_hours(smallint, boolean, time, time) to authenticated;
grant execute on function public.owner_update_business_contact(text, text, text, numeric) to authenticated;
grant execute on function public.owner_reschedule_appointment(uuid, timestamptz) to authenticated;