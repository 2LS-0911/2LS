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

const C = {
  bg: "#f5f3ee",
  surface: "#ffffff",
  border: "#ddd8ce",
  text: "#0f172a",
  textSub: "#64748b",
  textMuted: "#94a3b8",
  blue: "#7ec8f0",
  blueBg: "#e8f6fd",
  green: "#16a34a",
  greenBg: "#f0fdf4",
  amber: "#d97706",
  amberBg: "#fffbeb",
  red: "#dc2626",
  redBg: "#fef2f2",
};

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "9px 12px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", ...extra };
}
function btn(variant: "primary"|"success"|"danger"|"ghost" = "primary", disabled = false): React.CSSProperties {
  const bg = disabled ? C.border : variant === "primary" ? C.blue : variant === "success" ? C.green : variant === "danger" ? C.red : C.surface;
  return { background: bg, color: disabled ? C.textMuted : variant === "ghost" ? C.text : "#fff", border: variant === "ghost" ? `1px solid ${C.border}` : "none", borderRadius: 8, padding: "10px 18px", cursor: disabled ? "default" : "pointer", fontSize: 14, fontWeight: 600, opacity: disabled ? .5 : 1, whiteSpace: "nowrap" as const };
}
function btnSm(variant: "primary"|"success"|"danger"|"ghost" = "ghost"): React.CSSProperties {
  return { background: variant === "primary" ? C.blueBg : variant === "success" ? C.greenBg : variant === "danger" ? C.redBg : C.surface, color: variant === "primary" ? C.blue : variant === "success" ? C.green : variant === "danger" ? C.red : C.text, border: `1px solid ${variant === "primary" ? "#bfdbfe" : variant === "success" ? "#bbf7d0" : variant === "danger" ? "#fecaca" : C.border}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" as const };
}
const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const th: React.CSSProperties = { padding: "10px 12px", color: C.textSub, textAlign: "left", fontWeight: 600, fontSize: 12, borderBottom: `2px solid ${C.border}` };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, verticalAlign: "middle", borderBottom: `1px solid ${C.border}` };

// ── Mobile info row helper ──────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.textMuted, flexShrink: 0, marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text, fontWeight: 500, textAlign: "right" }}>{children}</span>
    </div>
  );
}

export default function AdminPanel({ adminKey, onLogout }: { adminKey: string; onLogout?: () => void }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [tab, setTab] = useState<"stats"|"services"|"reps"|"cases"|"txns">("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [cases, setCases] = useState<{ case_id: string; vehicle: Record<string,string>; service_name: string; dtc_codes: string[]; root_cause: string; ai_rating: number; status: string; created_at: string }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tabLoaded, setTabLoaded] = useState<Set<string>>(new Set());

  const [analytics, setAnalytics] = useState<ServiceAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);

  const [editSvcId, setEditSvcId] = useState<string | null>(null);
  const [editSvc, setEditSvc] = useState<Partial<Service>>({});
  const [editRepId, setEditRepId] = useState<number | null>(null);
  const [editRep, setEditRep] = useState<Partial<Rep>>({});

  const [newSvcName, setNewSvcName] = useState(""); const [newSvcCity, setNewSvcCity] = useState("");
  const [newSvcPhone, setNewSvcPhone] = useState(""); const [newSvcRep, setNewSvcRep] = useState("");
  const [credSvcId, setCredSvcId] = useState(""); const [credCredits, setCredCredits] = useState(""); const [credNotes, setCredNotes] = useState("");
  const [newRepTgId, setNewRepTgId] = useState(""); const [newRepName, setNewRepName] = useState("");
  const [newRepUsername, setNewRepUsername] = useState(""); const [newRepPhone, setNewRepPhone] = useState("");
  const credAmount = credCredits ? parseInt(credCredits) * CREDIT_PRICE : 0;

  const q = (path: string) => `${API}${path}?key=${adminKey}`;
  async function apicall<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  const loadTab = useCallback(async (t: string, force = false) => {
    if (!force && tabLoaded.has(t)) return;
    setLoading(true); setError("");
    try {
      if (t === "stats") { setStats(await apicall<Stats>(q("/api/admin/stats"))); }
      else if (t === "services") {
        const [sv, rp] = await Promise.all([apicall<{ services: Service[] }>(q("/api/admin/services")), apicall<{ reps: Rep[] }>(q("/api/admin/reps"))]);
        setServices(sv.services); setReps(rp.reps);
      } else if (t === "reps") { setReps((await apicall<{ reps: Rep[] }>(q("/api/admin/reps"))).reps); }
      else if (t === "cases") { setCases((await apicall<{ cases: typeof cases }>(q("/api/manager/cases"))).cases); }
      else if (t === "txns") { setTxns((await apicall<{ transactions: Transaction[] }>(q("/api/admin/transactions"))).transactions); }
      setTabLoaded(prev => new Set(prev).add(t));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [adminKey, tabLoaded]);

  useEffect(() => { loadTab("stats"); }, []);
  useEffect(() => { loadTab(tab); }, [tab]);
  function refresh() { setTabLoaded(prev => { const s = new Set(prev); s.delete(tab); return s; }); loadTab(tab, true); }

  async function createService() {
    if (!newSvcName.trim()) return;
    setLoading(true); setError("");
    try { await apicall(`${API}/api/admin/service/create`, "POST", { name: newSvcName, city: newSvcCity, phone: newSvcPhone, rep_id: newSvcRep ? parseInt(newSvcRep) : null, admin_key: adminKey }); setNewSvcName(""); setNewSvcCity(""); setNewSvcPhone(""); setNewSvcRep(""); loadTab("services", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function saveService(id: string) {
    setLoading(true); setError("");
    try { await apicall(`${API}/api/admin/service/${id}?key=${adminKey}`, "PUT", { name: editSvc.name, city: editSvc.city, phone: editSvc.phone, rep_id: editSvc.rep_id ?? null, status: editSvc.status, admin_key: adminKey }); setEditSvcId(null); loadTab("services", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function deleteService(id: string, name: string) {
    setDeleteConfirm({ message: `Удалить сервис «${name}»?`, action: async () => {
      setLoading(true); setError("");
      try { await apicall(`${API}/api/admin/service/${id}?key=${adminKey}`, "DELETE"); loadTab("services", true); }
      catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
    }});
  }
  async function openAnalytics(service_id: string) {
    setAnalyticsLoading(true); setAnalytics(null);
    try { setAnalytics(await apicall<ServiceAnalytics>(`${API}/api/admin/service/${service_id}/analytics?key=${adminKey}`)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setAnalyticsLoading(false); }
  }
  async function createRep() {
    if (!newRepName.trim()) { setError("Укажите имя"); return; }
    setLoading(true); setError("");
    try { await apicall(`${API}/api/admin/rep/create`, "POST", { telegram_id: newRepTgId ? parseInt(newRepTgId) : null, name: newRepName, username: newRepUsername, phone: newRepPhone, admin_key: adminKey }); setNewRepTgId(""); setNewRepName(""); setNewRepUsername(""); setNewRepPhone(""); loadTab("reps", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function saveRep(id: number) {
    setLoading(true); setError("");
    try { await apicall(`${API}/api/admin/rep/${id}?key=${adminKey}`, "PUT", { name: editRep.name, username: editRep.username, phone: editRep.phone, admin_key: adminKey }); setEditRepId(null); loadTab("reps", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function deleteRep(id: number, name: string) {
    setDeleteConfirm({ message: `Удалить представителя «${name}»?`, action: async () => {
      setLoading(true); setError("");
      try { await apicall(`${API}/api/admin/rep/${id}?key=${adminKey}`, "DELETE"); loadTab("reps", true); }
      catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
    }});
  }
  async function addCredits() {
    if (!credSvcId || !credCredits) return;
    setLoading(true); setError("");
    try {
      const data = await apicall<{ rep_commission_rub: number }>(`${API}/api/admin/service/credits`, "POST", { service_id: credSvcId, credits: parseInt(credCredits), amount_rub: credAmount, notes: credNotes, admin_key: adminKey });
      alert(`Зачислено ${credCredits} кр. на ${credAmount.toLocaleString("ru-RU")} ₽. Комиссия: ${data.rep_commission_rub.toLocaleString("ru-RU")} ₽`);
      setCredSvcId(""); setCredCredits(""); setCredNotes(""); loadTab("services", true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function approveCase(caseId: string) {
    setLoading(true); setError("");
    try { await apicall(`${API}/api/manager/approve/${caseId}?key=${adminKey}`, "POST"); loadTab("cases", true); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function deleteCase(caseId: string) {
    setDeleteConfirm({ message: "Удалить кейс безвозвратно?", action: async () => {
      setLoading(true); setError("");
      try { await apicall(`${API}/api/manager/case/${caseId}?key=${adminKey}`, "DELETE"); loadTab("cases", true); }
      catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
    }});
  }
  async function deleteTxn(txnId: string) {
    setDeleteConfirm({ message: "Удалить транзакцию?", action: async () => {
      setLoading(true); setError("");
      try { await apicall(`${API}/api/admin/transaction/${txnId}?key=${adminKey}`, "DELETE"); loadTab("txns", true); }
      catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
    }});
  }
  async function deleteZeroTxns() {
    setDeleteConfirm({ message: "Удалить все нулевые транзакции (0 ₽, 0 кредитов)?", action: async () => {
      setLoading(true); setError("");
      try { await apicall(`${API}/api/admin/transactions/zero?key=${adminKey}`, "DELETE"); loadTab("txns", true); }
      catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
    }});
  }

  const tabs = [
    { id: "stats", label: "Статистика", icon: "📊" },
    { id: "services", label: "Сервисы", icon: "🏪" },
    { id: "reps", label: "Представители", icon: "👥" },
    { id: "cases", label: "Кейсы", icon: "📋" },
    { id: "txns", label: "Транзакции", icon: "💳" },
  ] as const;

  const Spinner = () => (
    <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>
      <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 12px" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      Загрузка...
    </div>
  );

  // ── Analytics Modal ──────────────────────────────────────────────────────
  const AnalyticsModal = () => {
    if (!analytics && !analyticsLoading) return null;
    const a = analytics;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setAnalytics(null)}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", padding: isMobile ? 16 : 28, boxShadow: "0 20px 60px rgba(0,0,0,.15)" }} onClick={e => e.stopPropagation()}>
          {analyticsLoading && <Spinner />}
          {a && <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: C.text }}>📊 {a.service.name}</h2>
              <button style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 22 }} onClick={() => setAnalytics(null)}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 16 }}>
              {[{ label: "Сессий", val: a.service.total_sessions, icon: "🔧" }, { label: "Решено", val: a.cases_total, icon: "✅" }, { label: "На проверке", val: a.cases_pending, icon: "⏳" }, { label: "В базе", val: a.cases_approved, icon: "📚" }].map(({ label, val, icon }) => (
                <div key={label} style={{ background: C.bg, borderRadius: 10, padding: "12px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 20 }}>{icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 2px", color: C.text }}>{val}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[{ title: "🚗 Топ марок", items: a.top_brands.map(b => ({ key: b.brand, val: b.count })) }, { title: "⚠️ Топ DTC", items: a.top_dtcs.map(d => ({ key: d.dtc, val: d.count })) }].map(({ title, items }) => (
                <div key={title} style={{ background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>{title}</div>
                  {items.length === 0 && <div style={{ color: C.textMuted, fontSize: 12 }}>Нет данных</div>}
                  {items.map(({ key, val }) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <code style={{ fontSize: 12, color: C.amber }}>{key || "—"}</code>
                      <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>}
        </div>
      </div>
    );
  };

  // ── Confirm Modal ────────────────────────────────────────────────────────
  const ConfirmModal = () => {
    if (!deleteConfirm) return null;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setDeleteConfirm(null)}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, boxShadow: "0 16px 48px rgba(0,0,0,.18)" }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>🗑</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, textAlign: "center", marginBottom: 6 }}>Подтверждение</div>
          <div style={{ fontSize: 13, color: C.textSub, textAlign: "center", marginBottom: 24 }}>{deleteConfirm.message}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...btn("ghost"), flex: 1 }} onClick={() => setDeleteConfirm(null)}>Отмена</button>
            <button style={{ ...btn("danger"), flex: 1 }} onClick={async () => { const a = deleteConfirm.action; setDeleteConfirm(null); await a(); }}>Удалить</button>
          </div>
        </div>
      </div>
    );
  };

  // ── Desktop zoom wrapper ─────────────────────────────────────────────────
  const zoomStyle: React.CSSProperties = !isMobile ? {
    zoom: 1.7,
    width: "calc(100vw / 1.7)",
    minHeight: "calc(100vh / 1.7)",
  } : {};

  const pad = isMobile ? "12px 16px" : "24px 28px";
  const maxW = isMobile ? "100%" : 1200;

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      <div style={zoomStyle}>

      {/* ── Top bar (desktop only) ── */}
      {!isMobile && (
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ width: 30, height: 30, background: C.blue, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>2LS</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Администратор</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {loading && <span style={{ fontSize: 12, color: C.textMuted }}>Загрузка...</span>}
            <button style={{ ...btn("ghost"), padding: "7px 12px", fontSize: 13 }} onClick={refresh}>↻</button>
            <button
              title="Открыть в браузере (веб-версия)"
              onClick={() => { const tg = (window as any).Telegram?.WebApp; const url = `${window.location.origin}${window.location.pathname}?admin=1&key=${encodeURIComponent(adminKey)}`; if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank"); }}
              style={{ ...btn("ghost"), padding: "7px 12px", fontSize: 15 }}>
              🖥
            </button>
            {onLogout && (
              <button style={{ ...btn("ghost"), padding: "7px 12px", fontSize: 13, color: C.red }} onClick={onLogout} title="Выйти">
                Выйти
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: pad, maxWidth: maxW, margin: "0 auto", paddingBottom: isMobile ? "80px" : pad }}>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid #fecaca`, borderRadius: 10, padding: "12px 14px", marginBottom: 14, color: C.red, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span>{error}</span>
            <button style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 18 }} onClick={() => setError("")}>×</button>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 20, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: tab === t.id ? C.blue : "none", color: tab === t.id ? "#fff" : C.textSub, border: "none", borderRadius: 7, padding: isMobile ? "8px 12px" : "7px 16px", cursor: "pointer", fontSize: isMobile ? 12 : 13, fontWeight: tab === t.id ? 700 : 500, transition: "all .15s", whiteSpace: "nowrap" as const, flex: isMobile ? "1 1 auto" : undefined, textAlign: "center" as const }}>
              {t.icon}{isMobile ? "" : ` ${t.label}`}
            </button>
          ))}
        </div>

        {/* ══ STATS ══ */}
        {tab === "stats" && (loading && !stats ? <Spinner /> : stats ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
            {[
              { label: "Сервисов всего", val: stats.total_services, icon: "🏪", color: C.blue },
              { label: "Активных", val: stats.active_services, icon: "✅", color: C.green },
              { label: "Выручка", val: `${stats.total_revenue_rub.toLocaleString("ru-RU")} ₽`, icon: "💰", color: C.green },
              { label: "Сессий всего", val: stats.total_sessions, icon: "🔧", color: C.text },
              { label: "Кредитов остаток", val: stats.total_credits_remaining, icon: "🎫", color: C.amber },
              { label: "Кейсов на проверку", val: stats.pending_cases, icon: "📋", color: stats.pending_cases > 0 ? C.amber : C.text },
              { label: "Долг перед пред.", val: `${stats.total_rep_debt_rub.toLocaleString("ru-RU")} ₽`, icon: "👥", color: stats.total_rep_debt_rub > 0 ? C.red : C.text },
            ].map(({ label, val, icon, color }) => (
              <div key={label} style={{ ...card, textAlign: "center", marginBottom: 0 }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color, marginBottom: 4 }}>{val}</div>
                <div style={{ color: C.textSub, fontSize: 11 }}>{label}</div>
              </div>
            ))}
          </div>
        ) : null)}

        {/* ══ SERVICES ══ */}
        {tab === "services" && (loading && services.length === 0 ? <Spinner /> : <>

          {/* Form — добавить сервис */}
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: C.text }}>Добавить сервис</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <input style={inp()} placeholder="Название СТО *" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
              <input style={inp()} placeholder="Город" value={newSvcCity} onChange={e => setNewSvcCity(e.target.value)} />
              <input style={inp()} placeholder="Телефон" value={newSvcPhone} onChange={e => setNewSvcPhone(e.target.value)} />
              <select style={inp()} value={newSvcRep} onChange={e => setNewSvcRep(e.target.value)}>
                <option value="">— Без представителя —</option>
                {reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}
              </select>
            </div>
            <button style={{ ...btn("primary", !newSvcName.trim()), width: isMobile ? "100%" : "auto" }} onClick={createService} disabled={loading || !newSvcName.trim()}>Создать сервис</button>
          </div>

          {/* Form — пополнить кредиты */}
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: C.text }}>Пополнить кредиты</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 2fr", gap: 10, marginBottom: 10 }}>
              <select style={inp()} value={credSvcId} onChange={e => setCredSvcId(e.target.value)}>
                <option value="">— Выберите сервис —</option>
                {services.map(s => <option key={s.service_id} value={s.service_id}>{s.name} [{s.credits} кр.]</option>)}
              </select>
              <input style={inp()} placeholder="Кредиты" type="number" min="1" value={credCredits} onChange={e => setCredCredits(e.target.value)} />
              <div style={inp({ color: credAmount > 0 ? C.green : C.textMuted, fontWeight: credAmount > 0 ? 700 : 400 })}>{credAmount > 0 ? `${credAmount.toLocaleString("ru-RU")} ₽` : "0 ₽"}</div>
              <input style={inp()} placeholder="Примечание" value={credNotes} onChange={e => setCredNotes(e.target.value)} />
            </div>
            <button style={{ ...btn("primary", !credSvcId || !credCredits), width: isMobile ? "100%" : "auto" }} onClick={addCredits} disabled={loading || !credSvcId || !credCredits}>Зачислить</button>
          </div>

          {/* List */}
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 10 }}>Все сервисы ({services.length})</div>
          {isMobile ? (
            // ── Mobile cards ──
            services.map(s => (
              <div key={s.service_id} style={card}>
                {editSvcId === s.service_id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input style={inp()} value={editSvc.name || ""} placeholder="Название" onChange={e => setEditSvc(p => ({ ...p, name: e.target.value }))} />
                    <input style={inp()} value={editSvc.city || ""} placeholder="Город" onChange={e => setEditSvc(p => ({ ...p, city: e.target.value }))} />
                    <input style={inp()} value={editSvc.phone || ""} placeholder="Телефон" onChange={e => setEditSvc(p => ({ ...p, phone: e.target.value }))} />
                    <select style={inp()} value={editSvc.rep_id ?? ""} onChange={e => setEditSvc(p => ({ ...p, rep_id: e.target.value ? parseInt(e.target.value) : null }))}>
                      <option value="">— нет —</option>{reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}
                    </select>
                    <select style={inp()} value={editSvc.status || "active"} onChange={e => setEditSvc(p => ({ ...p, status: e.target.value }))}>
                      <option value="active">активен</option><option value="blocked">заблокирован</option>
                    </select>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...btnSm("success"), flex: 1 }} onClick={() => saveService(s.service_id)}>Сохранить</button>
                      <button style={{ ...btnSm(), flex: 1 }} onClick={() => setEditSvcId(null)}>Отмена</button>
                    </div>
                  </div>
                ) : (<>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{s.service_id}</div>
                    </div>
                    <span style={{ background: s.status === "active" ? C.greenBg : C.redBg, color: s.status === "active" ? C.green : C.red, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                      {s.status === "active" ? "активен" : "заблок"}
                    </span>
                  </div>
                  <Row label="Город">{s.city || "—"}</Row>
                  <Row label="Телефон">{s.phone || "—"}</Row>
                  <Row label="Представитель">{s.rep_name || "—"}</Row>
                  <Row label="Кредиты"><span style={{ color: s.credits > 0 ? C.green : C.red, fontWeight: 700 }}>{s.credits}</span></Row>
                  <Row label="Сессий">{s.total_sessions}</Row>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button style={{ ...btnSm("primary"), flex: 1 }} onClick={() => { setEditSvcId(s.service_id); setEditSvc({ name: s.name, city: s.city, phone: s.phone, rep_id: s.rep_id, status: s.status }); }}>Изменить</button>
                    <button style={btnSm("ghost")} onClick={() => openAnalytics(s.service_id)}>📊</button>
                    <button style={btnSm("danger")} onClick={() => deleteService(s.service_id, s.name)}>🗑</button>
                  </div>
                </>)}
              </div>
            ))
          ) : (
            // ── Desktop table ──
            <div style={card}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Название", "Город", "Телефон", "Представитель", "Кредиты", "Сессий", "Статус", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{services.map(s => (
                    editSvcId === s.service_id ? (
                      <tr key={s.service_id} style={{ background: C.blueBg }}>
                        <td style={td}><input style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editSvc.name || ""} onChange={e => setEditSvc(p => ({ ...p, name: e.target.value }))} /></td>
                        <td style={td}><input style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editSvc.city || ""} onChange={e => setEditSvc(p => ({ ...p, city: e.target.value }))} /></td>
                        <td style={td}><input style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editSvc.phone || ""} onChange={e => setEditSvc(p => ({ ...p, phone: e.target.value }))} /></td>
                        <td style={td}><select style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editSvc.rep_id ?? ""} onChange={e => setEditSvc(p => ({ ...p, rep_id: e.target.value ? parseInt(e.target.value) : null }))}><option value="">— нет —</option>{reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}</select></td>
                        <td style={td}>{s.credits}</td><td style={td}>{s.total_sessions}</td>
                        <td style={td}><select style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editSvc.status || "active"} onChange={e => setEditSvc(p => ({ ...p, status: e.target.value }))}><option value="active">активен</option><option value="blocked">заблокирован</option></select></td>
                        <td style={td}><button style={btnSm("success")} onClick={() => saveService(s.service_id)}>Сохранить</button><button style={btnSm()} onClick={() => setEditSvcId(null)}>Отмена</button></td>
                      </tr>
                    ) : (
                      <tr key={s.service_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={td}><div style={{ fontWeight: 600 }}>{s.name}</div><div style={{ color: C.textMuted, fontSize: 11 }}>{s.service_id}</div></td>
                        <td style={{ ...td, color: C.textSub }}>{s.city || "—"}</td>
                        <td style={{ ...td, color: C.textSub }}>{s.phone || "—"}</td>
                        <td style={{ ...td, color: C.textSub }}>{s.rep_name || "—"}</td>
                        <td style={{ ...td, color: s.credits > 0 ? C.green : C.red, fontWeight: 700 }}>{s.credits}</td>
                        <td style={td}>{s.total_sessions}</td>
                        <td style={td}><span style={{ background: s.status === "active" ? C.greenBg : C.redBg, color: s.status === "active" ? C.green : C.red, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.status === "active" ? "активен" : "заблок"}</span></td>
                        <td style={td}>
                          <button style={btnSm("primary")} onClick={() => { setEditSvcId(s.service_id); setEditSvc({ name: s.name, city: s.city, phone: s.phone, rep_id: s.rep_id, status: s.status }); }}>Изменить</button>
                          <button style={btnSm("ghost")} onClick={() => openAnalytics(s.service_id)}>📊</button>
                          <button style={btnSm("danger")} onClick={() => deleteService(s.service_id, s.name)}>Удалить</button>
                        </td>
                      </tr>
                    )
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>)}

        {/* ══ REPS ══ */}
        {tab === "reps" && (loading && reps.length === 0 ? <Spinner /> : <>
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Добавить представителя</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <input style={inp()} placeholder="Имя *" value={newRepName} onChange={e => setNewRepName(e.target.value)} />
              <input style={inp()} placeholder="@username" value={newRepUsername} onChange={e => setNewRepUsername(e.target.value)} />
              <input style={inp()} placeholder="Телефон" value={newRepPhone} onChange={e => setNewRepPhone(e.target.value)} />
              <input style={inp()} placeholder="Telegram ID" value={newRepTgId} onChange={e => setNewRepTgId(e.target.value)} />
            </div>
            <button style={{ ...btn("primary", !newRepName.trim()), width: isMobile ? "100%" : "auto" }} onClick={createRep} disabled={loading || !newRepName.trim()}>Добавить</button>
          </div>

          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 10 }}>Представители ({reps.length})</div>
          {isMobile ? (
            reps.map(r => (
              <div key={r.telegram_id} style={card}>
                {editRepId === r.telegram_id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input style={inp()} value={editRep.name || ""} placeholder="Имя" onChange={e => setEditRep(p => ({ ...p, name: e.target.value }))} />
                    <input style={inp()} value={editRep.username || ""} placeholder="@username" onChange={e => setEditRep(p => ({ ...p, username: e.target.value }))} />
                    <input style={inp()} value={editRep.phone || ""} placeholder="Телефон" onChange={e => setEditRep(p => ({ ...p, phone: e.target.value }))} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...btnSm("success"), flex: 1 }} onClick={() => saveRep(r.telegram_id)}>Сохранить</button>
                      <button style={{ ...btnSm(), flex: 1 }} onClick={() => setEditRepId(null)}>Отмена</button>
                    </div>
                  </div>
                ) : (<>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{r.name}</div>
                  <Row label="Telegram">@{r.username || "—"}</Row>
                  <Row label="Телефон">{r.phone || "—"}</Row>
                  <Row label="Сервисов">{r.services_count}</Row>
                  <Row label="Заработано"><span style={{ color: C.green, fontWeight: 600 }}>{(r.total_earned_rub || 0).toLocaleString("ru-RU")} ₽</span></Row>
                  <Row label="К выплате"><span style={{ color: (r.pending_payout_rub || 0) > 0 ? C.amber : C.textSub, fontWeight: (r.pending_payout_rub || 0) > 0 ? 700 : 400 }}>{(r.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽</span></Row>
                  <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <button style={{ ...btnSm("primary"), flex: 1 }} onClick={() => { setEditRepId(r.telegram_id); setEditRep({ name: r.name, username: r.username, phone: r.phone }); }}>Изменить</button>
                    <button style={btnSm("ghost")} onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?rep_token=${r.rep_token}`)}>📋</button>
                    <button style={btnSm("danger")} onClick={() => deleteRep(r.telegram_id, r.name)}>🗑</button>
                  </div>
                </>)}
              </div>
            ))
          ) : (
            <div style={card}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Имя", "Telegram", "Телефон", "Сервисов", "Заработано", "К выплате", "Ссылка", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{reps.map(r => (
                    editRepId === r.telegram_id ? (
                      <tr key={r.telegram_id} style={{ background: C.blueBg }}>
                        <td style={td}><input style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editRep.name || ""} onChange={e => setEditRep(p => ({ ...p, name: e.target.value }))} /></td>
                        <td style={td}><input style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editRep.username || ""} onChange={e => setEditRep(p => ({ ...p, username: e.target.value }))} /></td>
                        <td style={td}><input style={{ ...inp(), fontSize: 12, padding: "5px 8px" }} value={editRep.phone || ""} onChange={e => setEditRep(p => ({ ...p, phone: e.target.value }))} /></td>
                        <td style={td}>{r.services_count}</td>
                        <td style={td}>{(r.total_earned_rub||0).toLocaleString("ru-RU")} ₽</td>
                        <td style={td}>{(r.pending_payout_rub||0).toLocaleString("ru-RU")} ₽</td>
                        <td style={td} />
                        <td style={td}><button style={btnSm("success")} onClick={() => saveRep(r.telegram_id)}>Сохранить</button><button style={btnSm()} onClick={() => setEditRepId(null)}>Отмена</button></td>
                      </tr>
                    ) : (
                      <tr key={r.telegram_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ ...td, color: C.textSub }}>@{r.username || "—"}</td>
                        <td style={{ ...td, color: C.textSub }}>{r.phone || "—"}</td>
                        <td style={td}>{r.services_count}</td>
                        <td style={{ ...td, color: C.green, fontWeight: 600 }}>{(r.total_earned_rub||0).toLocaleString("ru-RU")} ₽</td>
                        <td style={{ ...td, color: (r.pending_payout_rub||0) > 0 ? C.amber : C.textSub, fontWeight: (r.pending_payout_rub||0) > 0 ? 700 : 400 }}>{(r.pending_payout_rub||0).toLocaleString("ru-RU")} ₽</td>
                        <td style={td}><button style={btnSm("ghost")} onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?rep_token=${r.rep_token}`)}>📋 Скопировать</button></td>
                        <td style={td}>
                          <button style={btnSm("primary")} onClick={() => { setEditRepId(r.telegram_id); setEditRep({ name: r.name, username: r.username, phone: r.phone }); }}>Изменить</button>
                          <button style={btnSm("danger")} onClick={() => deleteRep(r.telegram_id, r.name)}>Удалить</button>
                        </td>
                      </tr>
                    )
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>)}

        {/* ══ CASES ══ */}
        {tab === "cases" && (loading && cases.length === 0 ? <Spinner /> : <>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 4 }}>Кейсы на проверку ({cases.length})</div>
          <div style={{ color: C.textSub, fontSize: 12, marginBottom: 14 }}>Нажмите «Одобрить» — кейс уйдёт в базу знаний как новый атом.</div>
          {cases.length === 0
            ? <div style={{ ...card, textAlign: "center", padding: "40px 0", color: C.textMuted }}>Новых кейсов нет</div>
            : isMobile ? (
              cases.map(c => (
                <div key={c.case_id} style={card}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{c.vehicle?.brand} {c.vehicle?.model} <span style={{ fontWeight: 400, fontSize: 12, color: C.textMuted }}>{c.vehicle?.year}</span></div>
                  <Row label="Сервис">{c.service_name || "—"}</Row>
                  <Row label="DTC">
                    {(c.dtc_codes || []).length > 0
                      ? <span>{(c.dtc_codes || []).map(d => <code key={d} style={{ background: C.amberBg, color: C.amber, padding: "1px 5px", borderRadius: 4, fontSize: 11, marginLeft: 4 }}>{d}</code>)}</span>
                      : <span style={{ color: C.textMuted }}>симптомы</span>}
                  </Row>
                  <Row label="Причина"><span style={{ fontSize: 12 }}>{c.root_cause || "—"}</span></Row>
                  <Row label="Оценка"><span style={{ color: C.amber }}>{"★".repeat(Math.max(0, c.ai_rating || 0))}</span></Row>
                  <Row label="Дата">{new Date(c.created_at).toLocaleDateString("ru-RU")}</Row>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button style={{ ...btnSm("success"), flex: 1 }} onClick={() => approveCase(c.case_id)} disabled={loading}>✓ Одобрить</button>
                    <button style={{ ...btnSm("danger"), flex: 1 }} onClick={() => deleteCase(c.case_id)} disabled={loading}>🗑 Удалить</button>
                  </div>
                </div>
              ))
            ) : (
              <div style={card}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Авто", "Сервис", "DTC", "Причина", "Оценка", "Дата", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{cases.map(c => (
                      <tr key={c.case_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={td}><div style={{ fontWeight: 600 }}>{c.vehicle?.brand} {c.vehicle?.model}</div><div style={{ color: C.textMuted, fontSize: 11 }}>{c.vehicle?.year} · {c.vehicle?.engine}</div></td>
                        <td style={{ ...td, color: C.textSub }}>{c.service_name || "—"}</td>
                        <td style={td}>{(c.dtc_codes||[]).map(d => <code key={d} style={{ background: C.amberBg, color: C.amber, padding: "1px 5px", borderRadius: 4, fontSize: 11, marginRight: 4 }}>{d}</code>)}{!c.dtc_codes?.length && <span style={{ color: C.textMuted, fontSize: 12 }}>симптомы</span>}</td>
                        <td style={{ ...td, maxWidth: 220 }}><div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.root_cause || "—"}</div></td>
                        <td style={td}><span style={{ color: C.amber, fontWeight: 700 }}>{"★".repeat(Math.max(0,c.ai_rating||0))}</span></td>
                        <td style={{ ...td, color: C.textMuted, fontSize: 12 }}>{new Date(c.created_at).toLocaleDateString("ru-RU")}</td>
                        <td style={td}><div style={{ display: "flex", gap: 6 }}><button style={btnSm("success")} onClick={() => approveCase(c.case_id)} disabled={loading}>✓ Одобрить</button><button style={btnSm("danger")} onClick={() => deleteCase(c.case_id)} disabled={loading}>🗑</button></div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )
          }
        </>)}

        {/* ══ TXNS ══ */}
        {tab === "txns" && (loading && txns.length === 0 ? <Spinner /> : <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Транзакции ({txns.length})</div>
            {txns.some(t => (t.amount_rub||0) <= 0 && (t.credits_added||0) <= 0) && (
              <button style={btnSm("danger")} onClick={deleteZeroTxns} disabled={loading}>🗑 Удалить нулевые</button>
            )}
          </div>
          {isMobile ? (
            txns.map(t => (
              <div key={t.txn_id} style={{ ...card, background: (t.amount_rub||0) <= 0 && (t.credits_added||0) <= 0 ? C.redBg : C.surface }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>{t.service_name}</div>
                  <button style={btnSm("danger")} onClick={() => deleteTxn(t.txn_id)}>🗑</button>
                </div>
                <Row label="Дата">{new Date(t.created_at).toLocaleString("ru-RU")}</Row>
                <Row label="Кредиты"><span style={{ color: C.green, fontWeight: 700 }}>+{t.credits_added}</span></Row>
                <Row label="Сумма">{(t.amount_rub||0).toLocaleString("ru-RU")} ₽</Row>
                <Row label="Комиссия"><span style={{ color: C.amber, fontWeight: t.rep_commission_rub > 0 ? 700 : 400 }}>{(t.rep_commission_rub||0).toLocaleString("ru-RU")} ₽</span></Row>
                {t.notes && <Row label="Примечание">{t.notes}</Row>}
              </div>
            ))
          ) : (
            <div style={card}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Дата", "Сервис", "Кредиты", "Сумма", "Комиссия", "Примечание", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{txns.map(t => (
                    <tr key={t.txn_id} style={{ background: (t.amount_rub||0) <= 0 && (t.credits_added||0) <= 0 ? C.redBg : "" }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = (t.amount_rub||0) <= 0 && (t.credits_added||0) <= 0 ? C.redBg : "")}>
                      <td style={{ ...td, color: C.textSub, fontSize: 12 }}>{new Date(t.created_at).toLocaleString("ru-RU")}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{t.service_name}</td>
                      <td style={{ ...td, color: C.green, fontWeight: 700 }}>+{t.credits_added}</td>
                      <td style={td}>{(t.amount_rub||0).toLocaleString("ru-RU")} ₽</td>
                      <td style={{ ...td, color: C.amber, fontWeight: t.rep_commission_rub > 0 ? 700 : 400 }}>{(t.rep_commission_rub||0).toLocaleString("ru-RU")} ₽</td>
                      <td style={{ ...td, color: C.textSub }}>{t.notes || "—"}</td>
                      <td style={td}><button style={btnSm("danger")} onClick={() => deleteTxn(t.txn_id)} disabled={loading}>🗑</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>)}

      </div>

      <AnalyticsModal />
      <ConfirmModal />

      {/* ── Bottom toolbar (mobile only) ── */}
      {isMobile && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, zIndex: 20, boxShadow: "0 -4px 16px rgba(0,0,0,.06)" }}>
          <div style={{ width: 30, height: 30, background: C.blue, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>2LS</div>
          <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Администратор</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {loading && <span style={{ fontSize: 11, color: C.textMuted }}>...</span>}
            <button style={{ ...btn("ghost"), padding: "7px 12px", fontSize: 13 }} onClick={refresh}>↻</button>
            <button
              title="Открыть в браузере"
              onClick={() => { const tg = (window as any).Telegram?.WebApp; const url = `${window.location.origin}${window.location.pathname}?admin=1&key=${encodeURIComponent(adminKey)}`; if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank"); }}
              style={{ ...btn("ghost"), padding: "7px 12px", fontSize: 15 }}>
              🖥
            </button>
            {onLogout && (
              <button style={{ ...btn("ghost"), padding: "7px 10px", fontSize: 12, color: C.red }} onClick={onLogout} title="Выйти">
                Выйти
              </button>
            )}
          </div>
        </div>
      )}

      </div>{/* /zoom */}
    </div>
  );
}
