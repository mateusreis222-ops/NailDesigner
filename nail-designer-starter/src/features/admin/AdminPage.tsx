import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CalendarDays, Clock3, Scissors, Users, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../lib/supabase";

type Tab = "agenda" | "clientes" | "servicos" | "financeiro" | "horarios";
type Service = { id: string; name: string; description: string | null; price: number; duration_minutes: number; active: boolean };
type Payment = { id: string; amount: number; status: string; refunded_amount: number };
type Customer = { full_name: string; phone: string | null };
type Appointment = {
  id: string;
  customer_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_name_snapshot: string;
  service_price_snapshot: number;
  deposit_amount: number;
  remaining_amount: number;
  profiles: Customer | null;
  payments: Payment[];
};
type Business = { pix_key: string | null; pix_holder: string | null; whatsapp_phone: string | null; deposit_percent: number };
type BusinessHour = { id: string; weekday: number; start_time: string; end_time: string; active: boolean };

const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const tabs: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "servicos", label: "Serviços", icon: Scissors },
  { id: "financeiro", label: "Financeiro", icon: Wallet },
  { id: "horarios", label: "Horários e Pix", icon: Clock3 },
];

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function dateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function AdminPage() {
  const { profile, signOut } = useAuth();
  const businessId = profile?.business_id;
  const [tab, setTab] = useState<Tab>("agenda");
  const [date, setDate] = useState(dateValue());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [business, setBusiness] = useState<Business>({ pix_key: "", pix_holder: "", whatsapp_phone: "", deposit_percent: 50 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editingServiceId, setEditingServiceId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [cancelResolutions, setCancelResolutions] = useState<Record<string, "refund" | "credit" | "retain">>({});
  const [cancelNotes, setCancelNotes] = useState<Record<string, string>>({});
  const [rescheduleValues, setRescheduleValues] = useState<Record<string, string>>({});
  const [hourValues, setHourValues] = useState<Record<number, { active: boolean; start: string; end: string }>>({});

  useEffect(() => {
    let active = true;
    if (!supabase || !businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([
      supabase.from("appointments")
        .select("id, customer_id, starts_at, ends_at, status, service_name_snapshot, service_price_snapshot, deposit_amount, remaining_amount, profiles!appointments_customer_id_fkey(full_name, phone), payments(id, amount, status, refunded_amount)")
        .eq("business_id", businessId).order("starts_at", { ascending: false }).limit(300),
      supabase.from("services")
        .select("id, name, description, price, duration_minutes, active")
        .eq("business_id", businessId).order("name"),
      supabase.from("business_hours")
        .select("id, weekday, start_time, end_time, active")
        .eq("business_id", businessId).order("weekday"),
      supabase.from("businesses")
        .select("pix_key, pix_holder, whatsapp_phone, deposit_percent")
        .eq("id", businessId).single(),
    ]).then(([appointmentResult, serviceResult, hoursResult, businessResult]) => {
      if (!active) return;
      const firstError = [appointmentResult.error, serviceResult.error, hoursResult.error, businessResult.error].find(Boolean);
      if (firstError) setError(firstError.message);
      setAppointments((appointmentResult.data ?? []) as unknown as Appointment[]);
      setServices((serviceResult.data ?? []) as Service[]);
      const storedHours = (hoursResult.data ?? []) as BusinessHour[];
      setHourValues(Object.fromEntries(weekdays.map((_, weekday) => {
        const row = storedHours.find((item) => item.weekday === weekday);
        return [weekday, { active: Boolean(row?.active), start: row?.start_time?.slice(0, 5) ?? "09:00", end: row?.end_time?.slice(0, 5) ?? "18:00" }];
      })));
      if (businessResult.data) setBusiness(businessResult.data as Business);
      setLoading(false);
    });
    return () => { active = false; };
  }, [businessId, refresh]);

  const selectedDayAppointments = useMemo(() => appointments.filter((appointment) => {
    const appointmentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date(appointment.starts_at));
    return appointmentDate === date;
  }), [appointments, date]);

  const customers = useMemo(() => {
    const unique = new Map<string, Customer>();
    appointments.forEach((appointment) => {
      if (appointment.profiles) unique.set(appointment.customer_id, appointment.profiles);
    });
    return Array.from(unique.entries()).map(([id, customer]) => ({ id, ...customer }));
  }, [appointments]);

  const paymentRows = useMemo(() => appointments.flatMap((appointment) =>
    (appointment.payments ?? []).map((payment) => ({ ...payment, appointment }))
  ), [appointments]);

  function showResult(message: string) {
    setError("");
    setNotice(message);
    setRefresh((value) => value + 1);
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !businessId) return;
    setSaving(true);
    setError("");
    const payload = { name: serviceName.trim(), description: serviceDescription.trim() || null, price: Number(servicePrice), duration_minutes: Number(serviceDuration) };
    const result = editingServiceId
      ? await supabase.from("services").update(payload).eq("id", editingServiceId).eq("business_id", businessId)
      : await supabase.from("services").insert({ ...payload, business_id: businessId });
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    setEditingServiceId("");
    setServiceName("");
    setServiceDescription("");
    setServicePrice("");
    setServiceDuration("60");
    showResult("Serviço salvo.");
  }

  function editService(service: Service) {
    setEditingServiceId(service.id);
    setServiceName(service.name);
    setServiceDescription(service.description ?? "");
    setServicePrice(String(service.price));
    setServiceDuration(String(service.duration_minutes));
    setTab("servicos");
  }

  async function toggleService(service: Service) {
    if (!supabase || !businessId) return;
    const { error: requestError } = await supabase.from("services").update({ active: !service.active }).eq("id", service.id).eq("business_id", businessId);
    if (requestError) setError(requestError.message);
    else showResult(service.active ? "Serviço desativado." : "Serviço publicado.");
  }

  async function callOwnerRpc(name: string, args: Record<string, unknown>, success: string) {
    if (!supabase) return;
    setSaving(true);
    setError("");
    const { error: requestError } = await supabase.rpc(name, args);
    setSaving(false);
    if (requestError) setError(requestError.message);
    else showResult(success);
  }

  async function saveHours(weekday: number) {
    const value = hourValues[weekday];
    if (!value) return;
    await callOwnerRpc("owner_set_business_hours", {
      p_weekday: weekday,
      p_active: value.active,
      p_start_time: value.active ? value.start : null,
      p_end_time: value.active ? value.end : null,
    }, "Disponibilidade atualizada.");
  }

  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await callOwnerRpc("owner_update_business_contact", {
      p_pix_key: business.pix_key,
      p_pix_holder: business.pix_holder,
      p_whatsapp_phone: business.whatsapp_phone,
      p_deposit_percent: Number(business.deposit_percent),
    }, "Dados de pagamento e contato salvos.");
  }

  if (!businessId) {
    return <main className="inner-page"><h1 className="page-title">Painel <em>não configurado.</em></h1><p className="muted">A conta de proprietária precisa estar associada a um negócio no perfil do Supabase.</p></main>;
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand admin-brand" to="/"><span className="brand-monogram">JS</span><span className="brand-name">JÉSSICA SOUZA<small>PAINEL</small></span></Link>
        <nav className="admin-nav" aria-label="Administração">
          {tabs.map(({ id, label, icon: Icon }) => <button className={`sidebar-item ${tab === id ? "selected" : ""}`} type="button" key={id} onClick={() => setTab(id)}><Icon size={17}/>{label}</button>)}
        </nav>
        <button className="admin-signout" type="button" onClick={() => void signOut()}>Sair</button>
      </aside>

      <section className="admin-content">
        <p className="eyebrow">JÉSSICA SOUZA · ADMINISTRAÇÃO</p>
        <h1 className="page-title">{tabs.find((item) => item.id === tab)?.label} <em>do estúdio.</em></h1>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        {loading ? <p className="muted">Carregando dados...</p> : <>
          {tab === "agenda" && <section className="admin-panel-section">
            <label className="admin-date">Data da agenda<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            {selectedDayAppointments.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Horário</th><th>Cliente</th><th>Serviço</th><th>Status</th><th>Ações</th></tr></thead><tbody>
              {selectedDayAppointments.map((appointment) => <tr key={appointment.id}>
                <td data-label="Horário">{dateTime(appointment.starts_at)}</td>
                <td data-label="Cliente">{appointment.profiles?.full_name ?? "Cliente"}<small>{appointment.profiles?.phone}</small></td>
                <td data-label="Serviço">{appointment.service_name_snapshot}<small>{money(Number(appointment.service_price_snapshot))}</small></td>
                <td data-label="Status">{appointment.status}</td>
                <td data-label="Ações"><div className="admin-row-actions">
                  {appointment.profiles?.phone && <a href={`https://wa.me/${appointment.profiles.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá, ${appointment.profiles.full_name}! Este é um lembrete do seu horário de ${appointment.service_name_snapshot} em ${dateTime(appointment.starts_at)}.`)}`} target="_blank" rel="noreferrer">Enviar lembrete</a>}
                  {appointment.status === "confirmed" && <button type="button" onClick={() => void callOwnerRpc("owner_update_appointment_status", { p_appointment_id: appointment.id, p_status: "completed" }, "Atendimento concluído.")}>Concluir</button>}
                  {appointment.status === "confirmed" && <button type="button" onClick={() => void callOwnerRpc("owner_update_appointment_status", { p_appointment_id: appointment.id, p_status: "no_show" }, "Ausência registrada.")}>Não compareceu</button>}
                  {["confirmed", "pending_payment"].includes(appointment.status) && <>
                    <input aria-label="Novo horário" type="datetime-local" value={rescheduleValues[appointment.id] ?? localDateTimeValue(appointment.starts_at)} onChange={(event) => setRescheduleValues((values) => ({ ...values, [appointment.id]: event.target.value }))} />
                    <button type="button" onClick={() => void callOwnerRpc("owner_reschedule_appointment", { p_appointment_id: appointment.id, p_starts_at: new Date(rescheduleValues[appointment.id] ?? localDateTimeValue(appointment.starts_at)).toISOString() }, "Agendamento remarcado.")}>Remarcar</button>
                    <select aria-label="Destino do sinal no cancelamento" value={cancelResolutions[appointment.id] ?? "refund"} onChange={(event) => setCancelResolutions((values) => ({ ...values, [appointment.id]: event.target.value as "refund" | "credit" | "retain" }))}><option value="refund">Estorno</option><option value="credit">Crédito</option><option value="retain">Reter sinal</option></select>
                    <input aria-label="Observação do cancelamento" placeholder="Observação (opcional)" value={cancelNotes[appointment.id] ?? ""} onChange={(event) => setCancelNotes((values) => ({ ...values, [appointment.id]: event.target.value }))} />
                    <button type="button" onClick={() => void callOwnerRpc("owner_cancel_appointment", { p_appointment_id: appointment.id, p_resolution: cancelResolutions[appointment.id] ?? "refund", p_notes: cancelNotes[appointment.id] ?? null }, "Agendamento cancelado. Confira e execute o destino do sinal manualmente.")}>Cancelar</button>
                  </>}
                </div></td>
              </tr>)}
            </tbody></table></div> : <div className="empty-state"><h2>Agenda livre nesta data</h2><p>Os horários reservados aparecerão aqui.</p></div>}
          </section>}

          {tab === "clientes" && <section className="admin-panel-section"><h2>Clientes com agendamentos</h2>{customers.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Nome</th><th>Telefone</th><th>Atendimentos</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td data-label="Nome">{customer.full_name}</td><td data-label="Telefone">{customer.phone ?? "Não informado"}</td><td data-label="Atendimentos">{appointments.filter((appointment) => appointment.customer_id === customer.id).length}</td></tr>)}</tbody></table></div> : <p className="muted">Ainda não há clientes com agendamentos.</p>}</section>}

          {tab === "servicos" && <section className="admin-panel-section">
            <h2>{editingServiceId ? "Editar serviço" : "Cadastrar serviço"}</h2>
            <form className="admin-form service-admin-form" onSubmit={(event) => void handleServiceSubmit(event)}>
              <label>Nome<input required value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></label>
              <label>Descrição<input value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} /></label>
              <label>Preço (R$)<input type="number" min="0" step="0.01" required value={servicePrice} onChange={(event) => setServicePrice(event.target.value)} /></label>
              <label>Duração (min)<input type="number" min="1" step="1" required value={serviceDuration} onChange={(event) => setServiceDuration(event.target.value)} /></label>
              <div className="admin-form-actions"><button className="button button-dark" type="submit" disabled={saving}>{saving ? "Salvando..." : editingServiceId ? "Salvar alterações" : "Adicionar serviço"}</button>{editingServiceId && <button className="button button-outline" type="button" onClick={() => { setEditingServiceId(""); setServiceName(""); setServiceDescription(""); setServicePrice(""); setServiceDuration("60"); }}>Cancelar edição</button>}</div>
            </form>
            <div className="admin-service-list">{services.map((service) => <article className="admin-service-row" key={service.id}><div><strong>{service.name}</strong><p>{service.description || "Sem descrição"}</p><small>{money(Number(service.price))} · {service.duration_minutes} min · {service.active ? "Publicado" : "Oculto"}</small></div><div className="admin-row-actions"><button type="button" onClick={() => editService(service)}>Editar</button><button type="button" onClick={() => void toggleService(service)}>{service.active ? "Desativar" : "Publicar"}</button></div></article>)}</div>
          </section>}

          {tab === "financeiro" && <section className="admin-panel-section"><h2>Sinais e pagamentos</h2>{paymentRows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Cliente / serviço</th><th>Valor</th><th>Status</th><th>Reembolso</th><th>Ações</th></tr></thead><tbody>{paymentRows.map(({ appointment, ...payment }) => <tr key={payment.id}><td data-label="Cliente / serviço">{appointment.profiles?.full_name ?? "Cliente"}<small>{appointment.service_name_snapshot} · {dateTime(appointment.starts_at)}</small></td><td data-label="Valor">{money(Number(payment.amount))}</td><td data-label="Status">{payment.status === "pending" ? "Pendente" : payment.status === "paid" ? "Recebido" : payment.status === "partially_refunded" ? "Parcialmente estornado" : payment.status === "refunded" ? "Estornado" : payment.status}</td><td data-label="Reembolso">{money(Number(payment.refunded_amount))}</td><td data-label="Ações"><div className="admin-row-actions">{payment.status === "pending" && <button type="button" onClick={() => void callOwnerRpc("owner_confirm_payment", { p_payment_id: payment.id }, "Pagamento confirmado e agendamento atualizado.")}>Confirmar Pix recebido</button>}{["paid", "partially_refunded"].includes(payment.status) && <><input aria-label="Valor do estorno efetuado" type="number" min="0.01" max={Number(payment.amount) - Number(payment.refunded_amount)} step="0.01" placeholder="Valor estornado" value={refundAmounts[payment.id] ?? ""} onChange={(event) => setRefundAmounts((values) => ({ ...values, [payment.id]: event.target.value }))} /><button type="button" disabled={!refundAmounts[payment.id]} onClick={() => { const amount = Number(refundAmounts[payment.id]); if (window.confirm(`Confirma que já devolveu ${money(amount)} fora do sistema?`)) void callOwnerRpc("owner_register_refund", { p_payment_id: payment.id, p_amount: amount }, "Estorno registrado. A transferência deve ser feita manualmente no banco."); }}>Registrar estorno manual</button></>}</div></td></tr>)}</tbody></table></div> : <p className="muted">Nenhum pagamento registrado até agora.</p>}<p className="form-notice">Confirmar ou registrar aqui não movimenta dinheiro. O Pix e qualquer devolução são feitos fora do aplicativo.</p></section>}

          {tab === "horarios" && <section className="admin-panel-section">
            <h2>Disponibilidade semanal</h2>
            <div className="hours-list">{weekdays.map((weekday, index) => { const value = hourValues[index] ?? { active: false, start: "09:00", end: "18:00" }; return <div className="hours-row" key={weekday}><strong>{weekday}</strong><label className="hours-toggle"><input type="checkbox" checked={value.active} onChange={(event) => setHourValues((values) => ({ ...values, [index]: { ...value, active: event.target.checked } }))} />Atende</label><div className="hours-time-range"><input aria-label={`${weekday}: início`} type="time" value={value.start} disabled={!value.active} onChange={(event) => setHourValues((values) => ({ ...values, [index]: { ...value, start: event.target.value } }))} /><span>às</span><input aria-label={`${weekday}: fim`} type="time" value={value.end} disabled={!value.active} onChange={(event) => setHourValues((values) => ({ ...values, [index]: { ...value, end: event.target.value } }))} /></div><button type="button" onClick={() => void saveHours(index)}>Salvar</button></div>; })}</div>
            <h2>Pix e contato</h2>
            <form className="admin-form business-settings-form" onSubmit={(event) => void saveBusiness(event)}>
              <label>Chave Pix<input value={business.pix_key ?? ""} onChange={(event) => setBusiness((value) => ({ ...value, pix_key: event.target.value }))} /></label>
              <label>Nome do favorecido<input value={business.pix_holder ?? ""} onChange={(event) => setBusiness((value) => ({ ...value, pix_holder: event.target.value }))} /></label>
              <label>WhatsApp com DDI e DDD<input type="tel" placeholder="5511999999999" value={business.whatsapp_phone ?? ""} onChange={(event) => setBusiness((value) => ({ ...value, whatsapp_phone: event.target.value }))} /></label>
              <label>Percentual do sinal (%)<input type="number" min="0.01" max="100" step="0.01" value={business.deposit_percent} onChange={(event) => setBusiness((value) => ({ ...value, deposit_percent: Number(event.target.value) }))} /></label>
              <button className="button button-dark" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar configurações"}</button>
            </form>
          </section>}
        </>}
      </section>
    </main>
  );
}