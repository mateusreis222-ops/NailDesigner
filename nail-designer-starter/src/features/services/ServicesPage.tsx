import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
};

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours}h ${remainder}min`;
  if (hours) return `${hours}h`;
  return `${remainder}min`;
}

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase
      .from("services")
      .select("id, name, description, price, duration_minutes")
      .eq("active", true)
      .order("name")
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        setServices((data ?? []) as Service[]);
        setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return (
    <main className="inner-page">
      <Link className="back-link" to="/">← Página inicial</Link>
      <p className="eyebrow">CUIDADO E SOFISTICAÇÃO</p>
      <h1 className="page-title">Nossos <em>serviços</em></h1>
      <p className="muted">Encontre o cuidado ideal para você.</p>
      {error && <p className="form-error" role="alert">Não foi possível carregar os serviços: {error}</p>}
      {loading ? <p className="muted">Carregando serviços...</p> : services.length ? (
        <div className="service-list">
          {services.map((service) => (
            <article className="service-row" key={service.id}>
              <div>
                <h2>{service.name}</h2>
                {service.description && <p className="muted">{service.description}</p>}
                <span className="service-duration">{formatDuration(service.duration_minutes)}</span>
              </div>
              <div className="service-action">
                <strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(service.price)}</strong>
                <Link className="button button-dark" to={`/agendar?servico=${service.id}`}>Agendar</Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">JS</span>
          <h2>{supabase ? "Nenhum serviço disponível" : "Catálogo indisponível"}</h2>
          <p>{supabase ? "A profissional ainda não publicou serviços." : "Configure o Supabase para consultar os serviços cadastrados."}</p>
          <Link className="button button-dark" to="/agendar">Iniciar agendamento</Link>
        </div>
      )}
    </main>
  );
}
