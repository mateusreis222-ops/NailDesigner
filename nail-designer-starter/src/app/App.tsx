import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CalendarDays, Instagram, MapPin, Menu, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import { BookingPage } from "../features/booking/BookingPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { AdminPage } from "../features/admin/AdminPage";
import { AuthPage } from "../features/auth/AuthPage";
import { AccountPage } from "../features/account/AccountPage";

function OwnerRoute() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <main className="inner-page"><p className="muted">Verificando acesso...</p></main>;
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (profile?.role !== "owner") return <main className="inner-page"><h1 className="page-title">Acesso <em>restrito.</em></h1><p className="muted">Esta área é exclusiva da profissional responsável.</p></main>;
  return <AdminPage />;
}

function CustomerRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="inner-page"><p className="muted">Verificando acesso...</p></main>;
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return <AccountPage />;
}

function HomePage() {
  const { session, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <main>
      <header className={`site-header ${mobileOpen ? "menu-open" : ""}`}>
        <Link className="brand" to="/">
          <span className="brand-monogram">JS</span>
          <span className="brand-name">JÉSSICA SOUZA<small>NAIL DESIGNER</small></span>
        </Link>
        <nav className="desktop-nav">
          <Link to="/servicos">Serviços</Link>
          <a href="#sobre">Sobre</a>
          <Link to="/agendar">Agendar</Link>
        </nav>
        <Link className="button button-dark header-cta" to="/agendar"><CalendarDays size={16}/> Agendar horário</Link>
        {session ? <><Link className="header-login" to="/minha-conta">Minha conta</Link><button className="header-login header-signout" type="button" onClick={() => void signOut()}>Sair</button></> : <Link className="header-login" to="/entrar">Entrar</Link>}
        <button className="icon-button mobile-menu" aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X/> : <Menu/>}</button>
        <nav className="mobile-nav" id="mobile-navigation" aria-label="Navegação móvel">
          <Link to="/servicos" onClick={() => setMobileOpen(false)}>Serviços</Link>
          <a href="#sobre" onClick={() => setMobileOpen(false)}>Sobre</a>
          <Link to="/agendar" onClick={() => setMobileOpen(false)}>Agendar</Link>
          {session ? <><Link to="/minha-conta" onClick={() => setMobileOpen(false)}>Minha conta</Link><button type="button" onClick={() => { setMobileOpen(false); void signOut(); }}>Sair</button></> : <><Link to="/entrar" onClick={() => setMobileOpen(false)}>Entrar</Link><Link to="/cadastro" onClick={() => setMobileOpen(false)}>Criar conta</Link></>}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><Sparkles size={14}/> BELEZA EM CADA DETALHE</p>
          <h1>Seu momento de<br/><em>cuidado e beleza.</em></h1>
          <p className="hero-description">Realce sua beleza com técnicas cuidadosas, acabamento impecável e uma experiência pensada para você.</p>
          <div className="hero-actions">
            <Link className="button button-dark" to="/agendar">Agendar meu horário <span>↗</span></Link>
            <Link className="text-link" to="/servicos">Conhecer serviços</Link>
          </div>
          <div className="hero-note"><span className="note-line"/> ATENDIMENTO COM HORA MARCADA</div>
        </div>
        <div className="hero-art" role="img" aria-label="Espaço reservado para fotografia de manicure">
          <div className="hero-art-label">JÉSSICA SOUZA <span>NAIL DESIGNER</span></div>
        </div>
      </section>

      <section className="intro-section" id="sobre">
        <p className="eyebrow">UM CUIDADO SÓ SEU</p>
        <h2>Elegância que aparece<br/><em>nos detalhes.</em></h2>
        <p>Escolha seu procedimento, encontre o melhor horário e deixe o restante com a gente.</p>
        <Link className="button button-outline" to="/servicos">Explorar procedimentos</Link>
      </section>

      <footer className="site-footer">
        <span>JÉSSICA SOUZA · NAIL DESIGNER</span>
        <span><MapPin size={14}/> Endereço a configurar</span>
        <span><Instagram size={14}/> Instagram a configurar</span>
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/servicos" element={<ServicesPage />} />
        <Route path="/agendar" element={<BookingPage />} />
        <Route path="/entrar" element={<AuthPage />} />
        <Route path="/cadastro" element={<AuthPage />} />
        <Route path="/minha-conta" element={<CustomerRoute />} />
        <Route path="/admin" element={<OwnerRoute />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </AuthProvider>
  );
}
