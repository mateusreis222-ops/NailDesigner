import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const registering = location.pathname === "/cadastro";
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const returnTo = (location.state as { from?: string } | null)?.from ?? "/agendar";

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => setCooldownSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!supabase) {
      setError("A integração com Supabase não está configurada neste ambiente.");
      return;
    }

    setSubmitting(true);
    try {
      if (registering) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim(), phone: phone.trim() || null } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Cadastro iniciado. Confira seu e-mail para confirmar a conta e entrar.");
        } else {
          navigate("/agendar", { replace: true });
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        navigate(returnTo, { replace: true });
      }
    } catch (requestError) {
      const errorMessage = requestError instanceof Error ? requestError.message : "Não foi possível concluir a operação.";
      const retryAfter = errorMessage.match(/after\s+(\d+)\s+seconds?/i);
      if (/security purposes|rate limit|too many requests/i.test(errorMessage)) {
        setCooldownSeconds(Number(retryAfter?.[1] ?? 60));
        setError("Por segurança, o Supabase limitou novas tentativas de cadastro.");
      } else {
        setError(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="inner-page auth-page">
      <Link className="back-link" to="/">← Página inicial</Link>
      <section className="auth-panel">
        <p className="eyebrow">JÉSSICA SOUZA · NAIL DESIGNER</p>
        <h1 className="page-title">{registering ? <>Criar <em>conta.</em></> : <>Bem-vinda de <em>volta.</em></>}</h1>
        <p className="muted">{registering ? "Crie seu acesso para acompanhar seus agendamentos." : "Entre para acessar seus agendamentos."}</p>

        {!supabase && <p className="form-notice" role="status">Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para habilitar o acesso.</p>}
        {message && <p className="form-success" role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}{cooldownSeconds > 0 && <> Aguarde {cooldownSeconds} segundo{cooldownSeconds === 1 ? "" : "s"} antes de tentar novamente.</>}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {registering && <label>Nome completo<input autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>}
          {registering && <label>Telefone (opcional)<input autoComplete="tel" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>}
          <label>E-mail<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Senha<input autoComplete={registering ? "new-password" : "current-password"} type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="button button-dark auth-submit" type="submit" disabled={submitting || !supabase || cooldownSeconds > 0}>
            {submitting ? "Aguarde..." : cooldownSeconds > 0 ? `Aguarde ${cooldownSeconds}s` : registering ? "Criar conta" : "Entrar"}
          </button>
        </form>

        <p className="auth-switch">
          {registering ? "Já tem uma conta? " : "Ainda não tem conta? "}
          <Link to={registering ? "/entrar" : "/cadastro"}>{registering ? "Entrar" : "Cadastre-se"}</Link>
        </p>
      </section>
    </main>
  );
}