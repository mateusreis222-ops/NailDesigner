import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../app/AuthContext";

type Appointment = {
  id: string;
  starts_at: string;
  status: string;
  cancellation_requested_at: string | null;
  service_name_snapshot: string;
  service_price_snapshot: number;
  deposit_amount: number;
  remaining_amount: number;
  reservation_expires_at: string | null;
  payments: { id: string; amount: number; status: string; refunded_amount: number }[];
  businesses: { pix_key: string | null; pix_holder: string | null; whatsapp_phone: string | null };
};

const appointmentStatus: Record<string, string> = {
  pending_payment: "Aguardando sinal",
  confirmed: "Confirmado",
  in_progress: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
  expired: "Reserva expirada",
  no_show: "Não compareceu",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function AccountPage() {
  const { session } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    if (!supabase || !session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void supabase
      .from("appointments")
      .select("id, starts_at, status, cancellation_requested_at, service_name_snapshot, service_price_snapshot, deposit_amount, remaining_amount, reservation_expires_at, payments(id, amount, status, refunded_amount), businesses(pix_key, pix_holder, whatsapp_phone)")
      .eq("customer_id", session.user.id)
      .order("starts_at", { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        setAppointments((data ?? []) as unknown as Appointment[]);
        setLoading(false);
      });
    return () => { active = false; };
  }, [session, refresh]);

  async function requestCancellation(appointmentId: string) {
    if (!supabase) return;
    setError("");
    const { error: requestError } = await supabase.rpc("request_appointment_cancellation", { p_appointment_id: appointmentId });
    if (requestError) setError(requestError.message);
    else setRefresh((value) => value + 1);
  }

  return (
    <main className="inner-page account-page">
      <Link className="back-link" to="/">← Página inicial</Link>
      <p className="eyebrow">ÁREA DA CLIENTE</p>
      <h1 className="page-title">Meus <em>agendamentos.</em></h1>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="muted">Carregando agendamentos...</p> : appointments.length ? (
        <div className="appointment-list">
          {appointments.map((appointment) => {
            const whatsappNumber = appointment.businesses?.whatsapp_phone?.replace(/\D/g, "");
            const whatsappText = encodeURIComponent(`Olá! Tenho uma dúvida sobre meu agendamento de ${appointment.service_name_snapshot} em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.starts_at))}. Código: ${appointment.id}.`);
            const rescheduleText = encodeURIComponent(`Olá! Gostaria de solicitar a remarcação do meu agendamento de ${appointment.service_name_snapshot} em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.starts_at))}. Código: ${appointment.id}.`);
            const cancellable = ["pending_payment", "confirmed"].includes(appointment.status) && new Date(appointment.starts_at) > new Date();
            return (
              <article className="appointment-card" key={appointment.id}>
                <div className="appointment-heading">
                  <div><h2>{appointment.service_name_snapshot}</h2><p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short" }).format(new Date(appointment.starts_at))}</p></div>
                  <span className={`status status-${appointment.status}`}>{appointmentStatus[appointment.status] ?? appointment.status}</span>
                </div>
                <div className="appointment-values">
                  <span>Total <strong>{money(Number(appointment.service_price_snapshot))}</strong></span>
                  <span>Sinal <strong>{money(Number(appointment.deposit_amount))}</strong></span>
                  <span>Restante <strong>{money(Number(appointment.remaining_amount))}</strong></span>
                </div>
                {appointment.status === "pending_payment" && appointment.businesses?.pix_key && <div className="pix-details"><span>Chave Pix para o sinal</span><strong>{appointment.businesses.pix_key}</strong>{appointment.businesses.pix_holder && <small>Favorecido: {appointment.businesses.pix_holder}</small>}{appointment.reservation_expires_at && <small>Válido até {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.reservation_expires_at))}</small>}</div>}
                {appointment.status === "pending_payment" && <p className="muted">A confirmação do pagamento é feita manualmente pela profissional.</p>}
                <div className="appointment-actions">
                  {cancellable && !appointment.cancellation_requested_at && <button className="button button-outline" type="button" onClick={() => void requestCancellation(appointment.id)}>Solicitar cancelamento</button>}
                  {cancellable && appointment.cancellation_requested_at && <span className="muted">Cancelamento em análise pela profissional</span>}
                  {cancellable && !appointment.cancellation_requested_at && whatsappNumber && <a className="text-link" href={`https://wa.me/${whatsappNumber}?text=${rescheduleText}`} target="_blank" rel="noreferrer">Solicitar remarcação</a>}
                  {whatsappNumber && <a className="text-link" href={`https://wa.me/${whatsappNumber}?text=${whatsappText}`} target="_blank" rel="noreferrer">Falar pelo WhatsApp</a>}
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state"><h2>Nenhum agendamento ainda</h2><p>Quando você reservar um horário, ele aparecerá aqui.</p><Link className="button button-dark" to="/agendar">Escolher horário</Link></div>}
    </main>
  );
}