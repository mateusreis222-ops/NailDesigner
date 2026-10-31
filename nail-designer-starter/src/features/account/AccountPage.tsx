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
  payments: { id: string; amount: number; status: string; refunded_amount: number; receipt_path: string | null; proof_submitted_at: string | null }[];
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
  const [notice, setNotice] = useState("");
  const [uploadingPaymentId, setUploadingPaymentId] = useState("");
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
      .select("id, starts_at, status, cancellation_requested_at, service_name_snapshot, service_price_snapshot, deposit_amount, remaining_amount, reservation_expires_at, payments(id, amount, status, refunded_amount, receipt_path, proof_submitted_at), businesses(pix_key, pix_holder, whatsapp_phone)")
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

  async function submitPaymentProof(appointment: Appointment, paymentId: string, file: File) {
    if (!supabase || !session) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      setError("Envie uma imagem JPG, PNG, WebP ou um PDF.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("O comprovante deve ter no máximo 5 MB.");
      return;
    }

    setError("");
    setNotice("");
    setUploadingPaymentId(paymentId);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "comprovante";
    const storagePath = `${session.user.id}/${appointment.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("payment-proofs")
      .upload(storagePath, file, { cacheControl: "3600", contentType: file.type, upsert: false });

    if (uploadError) {
      setError(uploadError.message);
      setUploadingPaymentId("");
      return;
    }

    const { error: submitError } = await supabase.rpc("submit_payment_proof", {
      p_payment_id: paymentId,
      p_storage_path: storagePath,
    });

    if (submitError) {
      await supabase.storage.from("payment-proofs").remove([storagePath]);
      setError(submitError.message);
      setUploadingPaymentId("");
      return;
    }

    setUploadingPaymentId("");
    setNotice("Comprovante enviado. A profissional vai conferir o pagamento.");
    setRefresh((value) => value + 1);
  }

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
      {notice && <p className="form-success" role="status">{notice}</p>}
      {loading ? <p className="muted">Carregando agendamentos...</p> : appointments.length ? (
        <div className="appointment-list">
          {appointments.map((appointment) => {
            const whatsappNumber = appointment.businesses?.whatsapp_phone?.replace(/\D/g, "");
            const whatsappText = encodeURIComponent(`Olá! Tenho uma dúvida sobre meu agendamento de ${appointment.service_name_snapshot} em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.starts_at))}. Código: ${appointment.id}.`);
            const rescheduleText = encodeURIComponent(`Olá! Gostaria de solicitar a remarcação do meu agendamento de ${appointment.service_name_snapshot} em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.starts_at))}. Código: ${appointment.id}.`);
            const pendingPayment = appointment.payments.find((payment) => payment.status === "pending");
            const reservationExpired = Boolean(appointment.reservation_expires_at && new Date(appointment.reservation_expires_at) <= new Date());
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
                {appointment.status === "pending_payment" && pendingPayment && <section className="proof-submit" aria-label="Comprovante do sinal">
                  {pendingPayment.receipt_path ? <p className="form-success">Comprovante enviado. Aguardando conferência da profissional.</p> : reservationExpired ? <p className="form-error">O prazo para enviar o sinal expirou. Fale com a profissional para verificar a disponibilidade.</p> : <>
                    <p className="muted">Depois de transferir o sinal via Pix, envie o comprovante por aqui.</p>
                    <label className={`button button-outline proof-upload ${uploadingPaymentId === pendingPayment.id ? "is-uploading" : ""}`}>
                      {uploadingPaymentId === pendingPayment.id ? "Enviando comprovante..." : "Escolher comprovante"}
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={Boolean(uploadingPaymentId)} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void submitPaymentProof(appointment, pendingPayment.id, file); }} />
                    </label>
                    <small className="proof-hint">JPG, PNG, WebP ou PDF · até 5 MB</small>
                  </>}
                </section>}
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