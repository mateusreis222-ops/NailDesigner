import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarCheck, Clock3, ShieldCheck } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../lib/supabase";

type Service = { id: string; business_id: string; name: string; price: number; duration_minutes: number };
type Slot = { starts_at: string; ends_at: string };
type Reservation = {
  appointment_id: string;
  service_name: string;
  service_price: number;
  deposit_amount: number;
  remaining_amount: number;
  reservation_expires_at: string | null;
  pix_key: string | null;
  pix_holder: string | null;
  whatsapp_phone: string | null;
};

function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function BookingPage() {
  const { session, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState(searchParams.get("servico") ?? "");
  const [date, setDate] = useState(localDateValue());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedService = useMemo(() => services.find((service) => service.id === serviceId) ?? null, [services, serviceId]);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setLoadingServices(false);
      return;
    }
    void supabase
      .from("services")
      .select("id, business_id, name, price, duration_minutes")
      .eq("active", true)
      .order("name")
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        const availableServices = (data ?? []) as Service[];
        setServices(availableServices);
        setServiceId((current) => current || availableServices[0]?.id || "");
        setLoadingServices(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setSlots([]);
    setSelectedSlot("");
    if (!supabase || !serviceId || !date) return;
    setLoadingSlots(true);
    void supabase.rpc("get_available_slots", { p_service_id: serviceId, p_date: date })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        setSlots((data ?? []) as Slot[]);
        setLoadingSlots(false);
      });
    return () => { active = false; };
  }, [serviceId, date]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!supabase || !selectedService || !selectedSlot) return;
    if (!session) {
      const returnTo = `${location.pathname}${location.search}`;
      navigate("/entrar", { state: { from: returnTo } });
      return;
    }

    setSubmitting(true);
    const { data, error: requestError } = await supabase.rpc("create_appointment", {
      p_service_id: selectedService.id,
      p_starts_at: selectedSlot,
    });
    setSubmitting(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    const created = (data as Reservation[] | null)?.[0];
    if (!created) {
      setError("Não foi possível confirmar a reserva. Tente novamente.");
      return;
    }
    setReservation(created);
  }

  if (reservation) {
    const whatsappNumber = reservation.whatsapp_phone?.replace(/\D/g, "");
    const whatsappText = encodeURIComponent(`Olá! Acabei de solicitar o agendamento de ${reservation.service_name} para ${dateTime(selectedSlot)}. Meu código é ${reservation.appointment_id}.`);
    return (
      <main className="inner-page">
        <p className="eyebrow">RESERVA SOLICITADA</p>
        <h1 className="page-title">Seu horário está <em>reservado.</em></h1>
        <section className="booking-result">
          <CalendarCheck size={30}/>
          <h2>{reservation.service_name}</h2>
          <p>{dateTime(selectedSlot)} · Total {money(Number(reservation.service_price))}</p>
          {reservation.deposit_amount > 0 ? <>
            <p className="deposit-due">Sinal: <strong>{money(Number(reservation.deposit_amount))}</strong></p>
            {reservation.pix_key ? <div className="pix-details"><span>Chave Pix</span><strong>{reservation.pix_key}</strong>{reservation.pix_holder && <small>Favorecido: {reservation.pix_holder}</small>}</div> : <p className="form-notice">O sinal será combinado diretamente com a profissional.</p>}
            {reservation.reservation_expires_at && <p className="muted">Pague até {dateTime(reservation.reservation_expires_at)} para manter o horário.</p>}
          </> : <p className="form-success">Seu horário está confirmado.</p>}
          <div className="booking-result-actions">
            {whatsappNumber && <a className="button button-dark" href={`https://wa.me/${whatsappNumber}?text=${whatsappText}`} target="_blank" rel="noreferrer">Avisar pelo WhatsApp</a>}
            <Link className="button button-outline" to="/minha-conta">Meus agendamentos</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="inner-page">
      <Link className="back-link" to="/">← Página inicial</Link>
      <p className="eyebrow">RESERVE SEU MOMENTO</p>
      <h1 className="page-title">Agende seu <em>horário.</em></h1>
      <div className="booking-steps">
        <div className={`step ${serviceId ? "active" : ""}`}><b>01</b><span>Serviço</span></div>
        <div className={`step ${selectedSlot ? "active" : ""}`}><b>02</b><span>Data e hora</span></div>
        <div className="step"><b>03</b><span>Confirmação</span></div>
      </div>
      {!supabase && <p className="form-notice">O Supabase ainda não está configurado neste ambiente.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {loadingServices ? <p className="muted">Carregando serviços...</p> : services.length ? (
        <form className="booking-form" onSubmit={handleSubmit}>
          <label>Serviço
            <select required value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
              {services.map((service) => <option value={service.id} key={service.id}>{service.name} · {money(service.price)} · {service.duration_minutes} min</option>)}
            </select>
          </label>
          <label>Data
            <input type="date" min={localDateValue()} value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <fieldset className="slot-fieldset">
            <legend>Horários disponíveis</legend>
            {loadingSlots ? <p className="muted">Consultando disponibilidade...</p> : slots.length ? (
              <div className="slot-list">
                {slots.map((slot) => <button className={`slot-button ${selectedSlot === slot.starts_at ? "selected" : ""}`} type="button" key={slot.starts_at} onClick={() => setSelectedSlot(slot.starts_at)}>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(slot.starts_at))}</button>)}
              </div>
            ) : <p className="muted">Nenhum horário disponível nesta data.</p>}
          </fieldset>
          {selectedService && <div className="booking-facts"><span><Clock3 size={15}/>{selectedService.duration_minutes} minutos</span><span><ShieldCheck size={15}/>Sinal calculado no servidor</span></div>}
          <button className="button button-dark" type="submit" disabled={!supabase || !selectedSlot || submitting || authLoading}>
            {submitting ? "Solicitando..." : session ? "Reservar horário" : "Entrar e reservar"}
          </button>
        </form>
      ) : <div className="empty-state"><CalendarCheck size={30}/><h2>Nenhum serviço disponível</h2><p>Os horários aparecerão depois que a profissional cadastrar os serviços e a agenda.</p></div>}
    </main>
  );
}
