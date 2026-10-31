alter table public.payments
  add column receipt_path text,
  add column proof_submitted_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "Customers can upload proofs for active reservations"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.appointments a
      join public.payments p on p.appointment_id = a.id
      where a.id::text = (storage.foldername(name))[2]
        and a.customer_id = auth.uid()
        and a.status = 'pending_payment'
        and a.reservation_expires_at > now()
        and p.status = 'pending'
        and p.receipt_path is null
    )
  );

create policy "Customers and owners can read submitted payment proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1
      from public.appointments a
      join public.payments p on p.appointment_id = a.id
      where p.receipt_path = storage.objects.name
        and (a.customer_id = auth.uid() or public.is_business_owner(a.business_id))
    )
  );

create policy "Customers can remove unsubmitted proof uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.appointments a
      join public.payments p on p.appointment_id = a.id
      where a.id::text = (storage.foldername(name))[2]
        and a.customer_id = auth.uid()
        and a.status = 'pending_payment'
        and p.status = 'pending'
        and p.receipt_path is null
    )
  );

create or replace function public.submit_payment_proof(p_payment_id uuid, p_storage_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_business_id uuid;
  v_appointment_status public.appointment_status;
  v_payment_status public.payment_status;
  v_reservation_expires_at timestamptz;
  v_receipt_path text;
begin
  select a.id, a.business_id, a.status, a.reservation_expires_at, p.status, p.receipt_path
  into v_appointment_id, v_business_id, v_appointment_status,
       v_reservation_expires_at, v_payment_status, v_receipt_path
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where p.id = p_payment_id
    and a.customer_id = auth.uid()
  for update of p, a;

  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_appointment_status <> 'pending_payment'
     or v_payment_status <> 'pending'
     or v_reservation_expires_at is null
     or v_reservation_expires_at <= now() then
    raise exception 'A reserva não está mais aguardando o sinal. Fale com a profissional para verificar o horário.' using errcode = 'P0001';
  end if;
  if v_receipt_path is not null then
    raise exception 'Já existe um comprovante enviado para este pagamento.' using errcode = 'P0001';
  end if;
  if p_storage_path is null
     or array_length(storage.foldername(p_storage_path), 1) <> 2
     or (storage.foldername(p_storage_path))[1] <> auth.uid()::text
     or (storage.foldername(p_storage_path))[2] <> v_appointment_id::text then
    raise exception 'O arquivo enviado não corresponde a este agendamento.' using errcode = '22023';
  end if;

  update public.payments
  set receipt_path = p_storage_path,
      proof_submitted_at = now()
  where id = p_payment_id;

  insert into public.audit_logs (actor_id, business_id, entity_type, entity_id, action, details)
  values (auth.uid(), v_business_id, 'payment', p_payment_id, 'payment_proof_submitted',
    jsonb_build_object('appointment_id', v_appointment_id));
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
  v_appointment_status public.appointment_status;
  v_payment_status public.payment_status;
  v_reservation_expires_at timestamptz;
begin
  select a.id, a.business_id, p.amount, a.status, p.status, a.reservation_expires_at
  into v_appointment_id, v_business_id, v_payment_amount,
       v_appointment_status, v_payment_status, v_reservation_expires_at
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  where p.id = p_payment_id
  for update of p, a;

  if not found or not public.is_business_owner(v_business_id) then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_payment_status <> 'pending' then
    raise exception 'Este pagamento não está pendente.' using errcode = 'P0001';
  end if;
  if v_appointment_status <> 'pending_payment' then
    raise exception 'Este agendamento foi cancelado ou expirou e não pode ser confirmado.' using errcode = 'P0001';
  end if;
  if v_reservation_expires_at is null or v_reservation_expires_at <= now() then
    raise exception 'O prazo da reserva expirou. Confirme a disponibilidade antes de aceitar o pagamento.' using errcode = 'P0001';
  end if;

  update public.payments
  set status = 'paid', paid_at = coalesce(paid_at, now())
  where id = p_payment_id and status = 'pending';

  update public.appointments
  set status = 'confirmed', reservation_expires_at = null, updated_at = now()
  where id = v_appointment_id and status = 'pending_payment';

  insert into public.audit_logs (actor_id, business_id, entity_type, entity_id, action, details)
  values (auth.uid(), v_business_id, 'payment', p_payment_id, 'manual_payment_confirmed',
    jsonb_build_object('amount', v_payment_amount, 'method', 'pix'));
end;
$$;

revoke all on function public.submit_payment_proof(uuid, text) from public, anon;
grant execute on function public.submit_payment_proof(uuid, text) to authenticated;