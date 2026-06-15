import React, { useState, useEffect, useCallback } from "react";

const API = "";

interface ServiceAnalytics {
  service: { service_id: string; name: string; city: string; credits: number; total_sessions: number; solved_cases: number; total_paid_rub: number; last_activity: string | null };
  cases_total: number; cases_pending: number; cases_approved: number;
  top_brands: { brand: string; count: number }[];
  top_dtcs: { dtc: string; count: number }[];
  recent_cases: { case_id: string; vehicle: Record<string, string>; dtc_codes: string[]; status: string; created_at: string }[];
}
interface Service {
  service_id: string; name: string; city: string; phone: string;
  rep_id: number | null; rep_name?: string; credits: number;
  total_sessions: number; solved_cases?: number; total_paid_rub: number;
  last_activity?: string; status: string; created_at: string;
}
interface Rep {
  telegram_id: number; name: string; username: string; phone: string;
  rep_token: string; total_earned_rub: number; pending_payout_rub: number; services_count: number; created_at: string;
}
interface Stats {
  total_services: number; active_services: number; total_revenue_rub: number;
  total_sessions: number; total_credits_remaining: number; pending_cases: number; total_rep_debt_rub: number;
}
interface Transaction {
  txn_id: string; service_name: string; amount_rub: number;
  credits_added: number; rep_commission_rub: number; notes: string; created_at: string;
}

const CREDIT_PRICE = 600;

// ── Light design tokens ───────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc",
  surface: "#ffffff",
  border: "#e2e8f0",
  borderHover: "#cbd5e1",
  text: "#0f172a",
  textSub: "#64748b",
  textMuted: "#94a3b8",
  blue: "#2563eb",
  blueBg: "#eff6ff",
  green: "#16a34a",
  greenBg: "#f0fdf4",
  amber: "#d97706",
  amberBg: "#fffbeb",
  red: "#dc2626",
  redBg: "#fef2f2",
};

const S = {
  inp: {
    background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, padding: "8px 12px", fontSize: 13, marginRight: 8, marginBottom: 8,
    outline: "none", transition: "border-color .15s",
  } as React.CSSProperties,
  inpSm: {
    background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, padding: "5px 8px", fontSize: 12, outline: "none", width: "100%",
  } as React.CSSProperties,
  btn: (variant: "primary" | "success" | "danger" | "ghost" = "primary", disabled = false): React.CSSProperties => ({
    background: disabled ? C.border : variant === "primary" ? C.blue : variant === "success" ? C.green : variant === "danger" ? C.red : C.surface,
    color: disabled ? C.textMuted : variant === "ghost" ? C.text : "#fff",
    border: variant === "ghost" ? `1px solid ${C.border}` : "none",
    borderRadius: 8, padding: "8px 16px", cursor: disabled ? "default" : "pointer",
    fontSize: 13, fontWeight: 600, marginRight: 6, marginBottom: 4, whiteSpace: "nowrap" as const, opacity: disabled ? .5 : 1,
  }),
  btnSm: (variant: "primary" | "success" | "danger" | "ghost" = "ghost"): React.CSSProperties => ({
    background: variant === "primary" ? C.blueBg : variant === "success" ? C.greenBg : variant === "danger" ? C.redBg : C.surface,
    color: variant === "primary" ? C.blue : variant === "success" ? C.green : variant === "danger" ? C.red : C.text,
    border: `1px solid ${variant === "primary" ? "#bfdbfe" : variant === "success" ? "#bbf7d0" : variant === "danger" ? "#fecaca" : C.border}`,
    borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
    fontWeight: 600, marginRight: 4, whiteSpace: "nowrap" as const,
  }),
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 } as React.CSSProperties,
  th: { padding: "10px 12px", color: C.textSub, textAlign: "left" as const, fontWeight: 600, fontSize: 12, borderBottom: `2px solid ${C.border}` },
  td: { padding: "10px 12px", fontSize: 13, verticalAlign: "middle" as const, borderBottom: `1px solid ${C.border}` },
};

export default function AdminPanel({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState<"stats" | "services" | "reps" | "cases" | "txns">("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [cases, setCases] = useState<{ case_id: string; vehicle: Record<string, string>; service_name: string; dtc_codes: string[]; root_cause: string; ai_rating: number; status: string; created_at: string }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tabLoaded, setTabLoaded] = useState<Set<string>>(new Set());

  // Analytics modal
  const [analytics, setAnalytics] = useState<ServiceAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Edit state
  const [editSvcId, setEditSvcId] = useState<string | null>(null);
  const [editSvc, setEditSvc] = useState<Partial<Service>>({});
  const [editRepId, setEditRepId] = useState<number | null>(null);
  const [editRep, setEditRep] = useState<Partial<Rep>>({});

  // Forms
  const [newSvcName, setNewSvcName] = useState(""); const [newSvcCity, setNewSvcCity] = useState("");
  const [newSvcPhone, setNewSvcPhone] = useState(""); const [newSvcRep, setNewSvcRep] = useState("");
  const [credSvcId, setCredSvcId] = useState(""); const [credCredits, setCredCredits] = useState(""); const [credNotes, setCredNotes] = useState("");
  const [newRepTgId, setNewRepTgId] = useState(""); const [newRepName, setNewRepName] = useState("");
  const [newRepUsername, setNewRepUsername] = useState(""); const [newRepPhone, setNewRepPhone] = useState("");
  const credAmount = credCredits ? parseInt(credCredits) * CREDIT_PRICE : 0;

  const q = (path: string) => `${API}${path}?key=${adminKey}`;
  async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // Load only what's needed for the active tab
  const loadTab = useCallback(async (t: string, force = false) => {
    if (!force && tabLoaded.has(t)) return;
    setLoading(true); setError("");
    try {
      if (t === "stats") {
        const s = await call<Stats>(q("/api/admin/stats"));
        setStats(s);
      } else if (t === "services") {
        const [sv, rp] = await Promise.all([
          call<{ services: Service[] }>(q("/api/admin/services")),
          call<{ reps: Rep[] }>(q("/api/admin/reps")),
        ]);
        setServices(sv.services); setReps(rp.reps);
      } else if (t === "reps") {
        const rp = await call<{ reps: Rep[] }>(q("/api/admin/reps"));
        setReps(rp.reps);
      } else if (t === "cases") {
        const c = await call<{ cases: typeof cases }>(q("/api/manager/cases"));
        setCases(c.cases);
      } else if (t === "txns") {
        const tx = await call<{ transactions: Transaction[] }>(q("/api/admin/transactions"));
        setTxns(tx.transactions);
      }
      setTabLoaded(prev => new Set(prev).add(t));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [adminKey, tabLoaded]);

  useEffect(() => { loadTab("stats"); }, []);
  useEffect(() => { loadTab(tab); }, [tab]);

  function refresh() { setTabLoaded(prev => { const s = new Set(prev); s.delete(tab); return s; }); loadTab(tab, true); }

  // CRUD
  async function createService() {
    if (!newSvcName.trim()) return;
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/service/create`, "POST", { name: newSvcName, city: newSvcCity, phone: newSvcPhone, rep_id: newSvcRep ? parseInt(newSvcRep) : null, admin_key: adminKey });
      setNewSvcName(""); setNewSvcCity(""); setNewSvcPhone(""); setNewSvcRep("");
      loadTab("services", true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function saveService(id: string) {
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/service/${id}?key=${adminKey}`, "PUT", { name: editSvc.name, city: editSvc.city, phone: editSvc.phone, rep_id: editSvc.rep_id ?? null, status: editSvc.status, admin_key: adminKey });
      setEditSvcId(null); loadTab("services", true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function deleteService(id: string, name: string) {
    if (!confirm(`Удалить сервис «${name}»?`)) return;
    setLoading(true); setError("");
    try { await call(`${API}/api/admin/service/${id}?key=${adminKey}`, "DELETE"); loadTab("services", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function openAnalytics(service_id: string) {
    setAnalyticsLoading(true); setAnalytics(null);
    try { setAnalytics(await call<ServiceAnalytics>(`${API}/api/admin/service/${service_id}/analytics?key=${adminKey}`)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAnalyticsLoading(false); }
  }
  async function createRep() {
    if (!newRepName.trim()) { setError("Укажите имя"); return; }
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/rep/create`, "POST", { telegram_id: newRepTgId ? parseInt(newRepTgId) : null, name: newRepName, username: newRepUsername, phone: newRepPhone, admin_key: adminKey });
      setNewRepTgId(""); setNewRepName(""); setNewRepUsername(""); setNewRepPhone("");
      loadTab("reps", true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function saveRep(id: number) {
    setLoading(true); setError("");
    try { await call(`${API}/api/admin/rep/${id}?key=${adminKey}`, "PUT", { name: editRep.name, username: editRep.username, phone: editRep.phone, admin_key: adminKey }); setEditRepId(null); loadTab("reps", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function deleteRep(id: number, name: string) {
    if (!confirm(`Удалить представителя «${name}»?`)) return;
    setLoading(true); setError("");
    try { await call(`${API}/api/admin/rep/${id}?key=${adminKey}`, "DELETE"); loadTab("reps", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function addCredits() {
    if (!credSvcId || !credCredits) return;
    setLoading(true); setError("");
    try {
      const data = await call<{ rep_commission_rub: number }>(`${API}/api/admin/service/credits`, "POST", { service_id: credSvcId, credits: parseInt(credCredits), amount_rub: credAmount, notes: credNotes, admin_key: adminKey });
      alert(`Зачислено ${credCredits} кр. на ${credAmount.toLocaleString("ru-RU")} ₽. Комиссия: ${data.rep_commission_rub.toLocaleString("ru-RU")} ₽`);
      setCredSvcId(""); setCredCredits(""); setCredNotes("");
      loadTab("services", true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function approveCase(caseId: string) {
    setLoading(true); setError("");
    try { await call(`${API}/api/manager/approve/${caseId}?key=${adminKey}`, "POST"); loadTab("cases", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function deleteCase(caseId: string) {
    if (!confirm("Удалить кейс безвозвратно?")) return;
    setLoading(true); setError("");
    try { await call(`${API}/api/manager/case/${caseId}?key=${adminKey}`, "DELETE"); loadTab("cases", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function deleteTxn(txnId: string) {
    if (!confirm("Удалить транзакцию?")) return;
    setLoading(true); setError("");
    try { await call(`${API}/api/admin/transaction/${txnId}?key=${adminKey}`, "DELETE"); loadTab("txns", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function deleteZeroTxns() {
    if (!confirm("Удалить все нулевые транзакции (0 ₽, 0 кредитов)?")) return;
    setLoading(true); setError("");
    try { await call(`${API}/api/admin/transactions/zero?key=${adminKey}`, "DELETE"); loadTab("txns", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // ── Tabs config ───────────────────────────────────────────────────────────
  const tabs = [
    { id: "stats", label: "Статистика", icon: "📊" },
    { id: "services", label: "Сервисы", icon: "🏪" },
    { id: "reps", label: "Представители", icon: "👥" },
    { id: "cases", label: "Кейсы", icon: "📋" },
    { id: "txns", label: "Транзакции", icon: "💳" },
  ] as const;

  // ── Spinner ───────────────────────────────────────────────────────────────
  const Spinner = () => (
    <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 12px" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      Загрузка...
    </div>
  );

  // ── Analytics Modal ───────────────────────────────────────────────────────
  const AnalyticsModal = () => {
    if (!analytics && !analyticsLoading) return null;
    const a = analytics;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setAnalytics(null)}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,.15)" }} onClick={e => e.stopPropagation()}>
          {analyticsLoading && <Spinner />}
          {a && <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: C.text }}>📊 {a.service.name}</h2>
              <button style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 22, lineHeight: 1 }} onClick={() => setAnalytics(null)}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
              {[{ label: "Сессий", val: a.service.total_sessions, icon: "🔧" }, { label: "Решено", val: a.cases_total, icon: "✅" }, { label: "На проверке", val: a.cases_pending, icon: "⏳" }, { label: "В базе", val: a.cases_approved, icon: "📚" }].map(({ label, val, icon }) => (
                <div key={label} style={{ background: C.bg, borderRadius: 10, padding: "14px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 22 }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px", color: C.text }}>{val}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: C.bg, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13, color: C.text }}>🚗 Топ марок</div>
                {a.top_brands.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>Нет данных</div>}
                {a.top_brands.map(({ brand, count }) => (
                  <div key={brand} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13 }}>{brand || "—"}</span>
                    <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{count}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: C.bg, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13, color: C.text }}>⚠️ Топ DTC</div>
                {a.top_dtcs.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>Нет данных</div>}
                {a.top_dtcs.map(({ dtc, count }) => (
                  <div key={dtc} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <code style={{ fontSize: 12, color: C.amber }}>{dtc}</code>
                    <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: C.bg, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13, color: C.text }}>📋 Последние диагностики</div>
              {a.recent_cases.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>Нет кейсов</div>}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: C.textSub }}>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>Авто</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>DTC</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>Дата</th>
                </tr></thead>
                <tbody>{a.recent_cases.map(c => (
                  <tr key={c.case_id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px" }}>{c.vehicle?.brand} {c.vehicle?.model} {c.vehicle?.year}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {(c.dtc_codes || []).map(d => <code key={d} style={{ marginRight: 4, color: C.amber, fontSize: 11 }}>{d}</code>)}
                      {!c.dtc_codes?.length && <span style={{ color: C.textMuted }}>симптомы</span>}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={{ color: c.status === "approved" ? C.green : C.amber, fontSize: 11, fontWeight: 600 }}>
                        {c.status === "approved" ? "✅ в базе" : "⏳ ожидает"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", color: C.textMuted }}>{new Date(c.created_at).toLocaleDateString("ru-RU")}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>

      {/* Top bar */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: 32, height: 32, background: C.blue, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>2L</div>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Панель администратора</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {loading && <span style={{ fontSize: 12, color: C.textMuted }}>Загрузка...</span>}
          <button style={S.btn("ghost")} onClick={refresh}>↻ Обновить</button>
        </div>
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid #fecaca`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: C.red, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span>{error}</span>
            <button style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, lineHeight: 1 }} onClick={() => setError("")}>×</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, width: "fit-content" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: tab === t.id ? C.blue : "none", color: tab === t.id ? "#fff" : C.textSub, border: "none", borderRadius: 7, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 700 : 500, transition: "all .15s", whiteSpace: "nowrap" as const }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── STATS ── */}
        {tab === "stats" && (
          loading && !stats ? <Spinner /> :
          stats ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
              {[
                { label: "Сервисов всего", val: stats.total_services, icon: "🏪", color: C.blue },
                { label: "Активных сервисов", val: stats.active_services, icon: "✅", color: C.green },
                { label: "Выручка", val: `${stats.total_revenue_rub.toLocaleString("ru-RU")} ₽`, icon: "💰", color: C.green },
                { label: "Сессий всего", val: stats.total_sessions, icon: "🔧", color: C.text },
                { label: "Кредитов остаток", val: stats.total_credits_remaining, icon: "🎫", color: C.amber },
                { label: "Кейсов на проверку", val: stats.pending_cases, icon: "📋", color: stats.pending_cases > 0 ? C.amber : C.text },
                { label: "Долг перед представит.", val: `${stats.total_rep_debt_rub.toLocaleString("ru-RU")} ₽`, icon: "👥", color: stats.total_rep_debt_rub > 0 ? C.red : C.text },
              ].map(({ label, val, icon, color }) => (
                <div key={label} style={{ ...S.card, textAlign: "center", marginBottom: 0 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color, marginBottom: 4 }}>{val}</div>
                  <div style={{ color: C.textSub, fontSize: 12 }}>{label}</div>
                </div>
              ))}
            </div>
          ) : null
        )}

        {/* ── SERVICES ── */}
        {tab === "services" && (
          loading && services.length === 0 ? <Spinner /> : <>
            {/* Create */}
            <div style={S.card}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.text }}>Добавить сервис</h3>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end" }}>
                <input style={{ ...S.inp, width: 200 }} placeholder="Название СТО *" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
                <input style={{ ...S.inp, width: 140 }} placeholder="Город" value={newSvcCity} onChange={e => setNewSvcCity(e.target.value)} />
                <input style={{ ...S.inp, width: 140 }} placeholder="Телефон" value={newSvcPhone} onChange={e => setNewSvcPhone(e.target.value)} />
                <select style={{ ...S.inp, width: 190 }} value={newSvcRep} onChange={e => setNewSvcRep(e.target.value)}>
                  <option value="">— Без представителя —</option>
                  {reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}
                </select>
                <button style={S.btn("primary", !newSvcName.trim())} onClick={createService} disabled={loading || !newSvcName.trim()}>Создать</button>
              </div>
            </div>

            {/* Add credits */}
            <div style={S.card}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.text }}>Пополнить кредиты</h3>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end" }}>
                <select style={{ ...S.inp, width: 260 }} value={credSvcId} onChange={e => setCredSvcId(e.target.value)}>
                  <option value="">— Выберите сервис —</option>
                  {services.map(s => <option key={s.service_id} value={s.service_id}>{s.name} ({s.city || "—"}) [{s.credits} кр.]</option>)}
                </select>
                <input style={{ ...S.inp, width: 100 }} placeholder="Кредиты" type="number" min="1" value={credCredits} onChange={e => setCredCredits(e.target.value)} />
                <div style={{ ...S.inp, color: credAmount > 0 ? C.green : C.textMuted, fontWeight: credAmount > 0 ? 700 : 400 }}>
                  {credAmount > 0 ? `${credAmount.toLocaleString("ru-RU")} ₽` : "0 ₽"}
                </div>
                <input style={{ ...S.inp, width: 180 }} placeholder="Примечание" value={credNotes} onChange={e => setCredNotes(e.target.value)} />
                <button style={S.btn("primary", !credSvcId || !credCredits)} onClick={addCredits} disabled={loading || !credSvcId || !credCredits}>Зачислить</button>
              </div>
            </div>

            {/* Table */}
            <div style={S.card}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.text }}>Все сервисы ({services.length})</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Название", "Город", "Телефон", "Представитель", "Кредиты", "Сессий", "Статус", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>{services.map(s => (
                    editSvcId === s.service_id ? (
                      <tr key={s.service_id} style={{ background: C.blueBg }}>
                        <td style={S.td}><input style={S.inpSm} value={editSvc.name || ""} onChange={e => setEditSvc(p => ({ ...p, name: e.target.value }))} /></td>
                        <td style={S.td}><input style={S.inpSm} value={editSvc.city || ""} onChange={e => setEditSvc(p => ({ ...p, city: e.target.value }))} /></td>
                        <td style={S.td}><input style={S.inpSm} value={editSvc.phone || ""} onChange={e => setEditSvc(p => ({ ...p, phone: e.target.value }))} /></td>
                        <td style={S.td}><select style={S.inpSm} value={editSvc.rep_id ?? ""} onChange={e => setEditSvc(p => ({ ...p, rep_id: e.target.value ? parseInt(e.target.value) : null }))}>
                          <option value="">— нет —</option>{reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}
                        </select></td>
                        <td style={S.td}>{s.credits}</td><td style={S.td}>{s.total_sessions}</td>
                        <td style={S.td}><select style={S.inpSm} value={editSvc.status || "active"} onChange={e => setEditSvc(p => ({ ...p, status: e.target.value }))}>
                          <option value="active">активен</option><option value="blocked">заблокирован</option>
                        </select></td>
                        <td style={S.td}>
                          <button style={S.btnSm("success")} onClick={() => saveService(s.service_id)}>Сохранить</button>
                          <button style={S.btnSm()} onClick={() => setEditSvcId(null)}>Отмена</button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={s.service_id} style={{ transition: "background .1s" }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={S.td}><div style={{ fontWeight: 600 }}>{s.name}</div><div style={{ color: C.textMuted, fontSize: 11 }}>{s.service_id}</div></td>
                        <td style={{ ...S.td, color: C.textSub }}>{s.city || "—"}</td>
                        <td style={{ ...S.td, color: C.textSub }}>{s.phone || "—"}</td>
                        <td style={{ ...S.td, color: C.textSub }}>{s.rep_name || "—"}</td>
                        <td style={{ ...S.td, color: s.credits > 0 ? C.green : C.red, fontWeight: 700 }}>{s.credits}</td>
                        <td style={S.td}>{s.total_sessions}</td>
                        <td style={S.td}><span style={{ background: s.status === "active" ? C.greenBg : C.redBg, color: s.status === "active" ? C.green : C.red, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                          {s.status === "active" ? "активен" : "заблок"}
                        </span></td>
                        <td style={S.td}>
                          <button style={S.btnSm("primary")} onClick={() => { setEditSvcId(s.service_id); setEditSvc({ name: s.name, city: s.city, phone: s.phone, rep_id: s.rep_id, status: s.status }); }}>Изменить</button>
                          <button style={S.btnSm("ghost")} onClick={() => openAnalytics(s.service_id)}>📊</button>
                          <button style={S.btnSm("danger")} onClick={() => deleteService(s.service_id, s.name)}>Удалить</button>
                        </td>
                      </tr>
                    )
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── REPS ── */}
        {tab === "reps" && (
          loading && reps.length === 0 ? <Spinner /> : <>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.text }}>Добавить представителя</h3>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end" }}>
                <input style={{ ...S.inp, width: 180 }} placeholder="Имя *" value={newRepName} onChange={e => setNewRepName(e.target.value)} />
                <input style={{ ...S.inp, width: 140 }} placeholder="@username" value={newRepUsername} onChange={e => setNewRepUsername(e.target.value)} />
                <input style={{ ...S.inp, width: 140 }} placeholder="Телефон" value={newRepPhone} onChange={e => setNewRepPhone(e.target.value)} />
                <input style={{ ...S.inp, width: 150 }} placeholder="Telegram ID" value={newRepTgId} onChange={e => setNewRepTgId(e.target.value)} />
                <button style={S.btn("primary", !newRepName.trim())} onClick={createRep} disabled={loading || !newRepName.trim()}>Добавить</button>
              </div>
            </div>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: C.text }}>Представители ({reps.length})</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Имя", "Telegram", "Телефон", "Сервисов", "Заработано", "К выплате", "Ссылка", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>{reps.map(r => (
                    editRepId === r.telegram_id ? (
                      <tr key={r.telegram_id} style={{ background: C.blueBg }}>
                        <td style={S.td}><input style={S.inpSm} value={editRep.name || ""} onChange={e => setEditRep(p => ({ ...p, name: e.target.value }))} /></td>
                        <td style={S.td}><input style={{ ...S.inpSm, width: 120 }} value={editRep.username || ""} onChange={e => setEditRep(p => ({ ...p, username: e.target.value }))} /></td>
                        <td style={S.td}><input style={S.inpSm} value={editRep.phone || ""} onChange={e => setEditRep(p => ({ ...p, phone: e.target.value }))} /></td>
                        <td style={S.td}>{r.services_count}</td>
                        <td style={S.td}>{(r.total_earned_rub || 0).toLocaleString("ru-RU")} ₽</td>
                        <td style={S.td}>{(r.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽</td>
                        <td style={S.td} />
                        <td style={S.td}>
                          <button style={S.btnSm("success")} onClick={() => saveRep(r.telegram_id)}>Сохранить</button>
                          <button style={S.btnSm()} onClick={() => setEditRepId(null)}>Отмена</button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={r.telegram_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ ...S.td, color: C.textSub }}>@{r.username || "—"}</td>
                        <td style={{ ...S.td, color: C.textSub }}>{r.phone || "—"}</td>
                        <td style={S.td}>{r.services_count}</td>
                        <td style={{ ...S.td, color: C.green, fontWeight: 600 }}>{(r.total_earned_rub || 0).toLocaleString("ru-RU")} ₽</td>
                        <td style={{ ...S.td, color: (r.pending_payout_rub || 0) > 0 ? C.amber : C.textSub, fontWeight: (r.pending_payout_rub || 0) > 0 ? 700 : 400 }}>{(r.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽</td>
                        <td style={S.td}>
                          <button style={S.btnSm("ghost")} onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?rep_token=${r.rep_token}`)}>📋 Скопировать</button>
                          <code style={{ fontSize: 10, color: C.textMuted }}>{r.rep_token}</code>
                        </td>
                        <td style={S.td}>
                          <button style={S.btnSm("primary")} onClick={() => { setEditRepId(r.telegram_id); setEditRep({ name: r.name, username: r.username, phone: r.phone }); }}>Изменить</button>
                          <button style={S.btnSm("danger")} onClick={() => deleteRep(r.telegram_id, r.name)}>Удалить</button>
                        </td>
                      </tr>
                    )
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── CASES ── */}
        {tab === "cases" && (
          loading && cases.length === 0 ? <Spinner /> :
          <div style={S.card}>
            <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: C.text }}>Кейсы на проверку ({cases.length})</h3>
            <p style={{ color: C.textSub, fontSize: 12, marginBottom: 16 }}>Здесь кейсы, которые механики сохранили после диагностики. Нажмите «Одобрить» — кейс уйдёт в базу знаний как новый атом.</p>
            {cases.length === 0
              ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted }}>Новых кейсов нет</div>
              : <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Авто", "Сервис", "DTC / Симптомы", "Причина", "Оценка", "Дата", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                    <tbody>{cases.map(c => (
                      <tr key={c.case_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={S.td}><div style={{ fontWeight: 600 }}>{c.vehicle?.brand} {c.vehicle?.model}</div><div style={{ color: C.textMuted, fontSize: 11 }}>{c.vehicle?.year} · {c.vehicle?.engine}</div></td>
                        <td style={{ ...S.td, color: C.textSub }}>{c.service_name || "—"}</td>
                        <td style={S.td}>
                          {(c.dtc_codes || []).map(d => <code key={d} style={{ background: C.amberBg, color: C.amber, padding: "1px 5px", borderRadius: 4, fontSize: 11, marginRight: 4 }}>{d}</code>)}
                          {!c.dtc_codes?.length && <span style={{ color: C.textMuted, fontSize: 12 }}>симптомы</span>}
                        </td>
                        <td style={{ ...S.td, maxWidth: 240 }}><div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.root_cause || "—"}</div></td>
                        <td style={S.td}><span style={{ color: C.amber, fontWeight: 700 }}>{"★".repeat(Math.max(0, c.ai_rating || 0))}</span></td>
                        <td style={{ ...S.td, color: C.textMuted, fontSize: 12 }}>{new Date(c.created_at).toLocaleDateString("ru-RU")}</td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button style={S.btnSm("success")} onClick={() => approveCase(c.case_id)} disabled={loading}>✓ Одобрить</button>
                            <button style={S.btnSm("danger")} onClick={() => deleteCase(c.case_id)} disabled={loading}>🗑 Удалить</button>
                          </div>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
            }
          </div>
        )}

        {/* ── TXNS ── */}
        {tab === "txns" && (
          loading && txns.length === 0 ? <Spinner /> :
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Транзакции ({txns.length})</h3>
              {txns.some(t => (t.amount_rub || 0) <= 0 && (t.credits_added || 0) <= 0) && (
                <button style={S.btnSm("danger")} onClick={deleteZeroTxns} disabled={loading}>
                  🗑 Удалить все нулевые
                </button>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Дата", "Сервис", "Кредиты", "Сумма", "Комиссия", "Примечание", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{txns.map(t => (
                  <tr key={t.txn_id}
                    style={{ background: (t.amount_rub || 0) <= 0 && (t.credits_added || 0) <= 0 ? (C.redBg || "#fff1f2") : "" }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                    onMouseLeave={e => (e.currentTarget.style.background = (t.amount_rub || 0) <= 0 && (t.credits_added || 0) <= 0 ? (C.redBg || "#fff1f2") : "")}>
                    <td style={{ ...S.td, color: C.textSub, fontSize: 12 }}>{new Date(t.created_at).toLocaleString("ru-RU")}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{t.service_name}</td>
                    <td style={{ ...S.td, color: C.green, fontWeight: 700 }}>+{t.credits_added}</td>
                    <td style={S.td}>{(t.amount_rub || 0).toLocaleString("ru-RU")} ₽</td>
                    <td style={{ ...S.td, color: C.amber, fontWeight: t.rep_commission_rub > 0 ? 700 : 400 }}>{(t.rep_commission_rub || 0).toLocaleString("ru-RU")} ₽</td>
                    <td style={{ ...S.td, color: C.textSub }}>{t.notes || "—"}</td>
                    <td style={S.td}><button style={S.btnSm("danger")} onClick={() => deleteTxn(t.txn_id)} disabled={loading}>🗑</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      <AnalyticsModal />
    </div>
  );
}
