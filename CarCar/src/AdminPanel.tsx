import React, { useState, useEffect } from "react";

const API = "";

interface ServiceAnalytics {
  service: { service_id: string; name: string; city: string; credits: number; total_sessions: number; solved_cases: number; total_paid_rub: number; last_activity: string | null };
  cases_total: number;
  cases_pending: number;
  cases_approved: number;
  top_brands: { brand: string; count: number }[];
  top_dtcs: { dtc: string; count: number }[];
  activity_by_day: { date: string; count: number }[];
  recent_cases: { case_id: string; vehicle: Record<string, string>; dtc_codes: string[]; status: string; created_at: string }[];
}

interface Service {
  service_id: string;
  name: string;
  city: string;
  phone: string;
  rep_id: number | null;
  rep_name?: string;
  credits: number;
  total_sessions: number;
  solved_cases?: number;
  total_paid_rub: number;
  last_activity?: string;
  status: string;
  created_at: string;
}

interface Rep {
  telegram_id: number;
  name: string;
  username: string;
  phone: string;
  rep_token: string;
  total_earned_rub: number;
  pending_payout_rub: number;
  services_count: number;
  created_at: string;
}

interface Stats {
  total_services: number;
  active_services: number;
  total_revenue_rub: number;
  total_sessions: number;
  total_credits_remaining: number;
  pending_cases: number;
  total_rep_debt_rub: number;
}

interface Transaction {
  txn_id: string;
  service_name: string;
  amount_rub: number;
  credits_added: number;
  rep_commission_rub: number;
  notes: string;
  created_at: string;
}

const CREDIT_PRICE = 600; // ₽ за кредит

// ── Styles ────────────────────────────────────────────────────────────────
const S = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "#0f1117",
    minHeight: "100vh",
    color: "#e1e4e8",
    padding: "24px",
  } as React.CSSProperties,

  card: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  } as React.CSSProperties,

  inp: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 6,
    color: "#e1e4e8",
    padding: "7px 10px",
    fontSize: 13,
    marginRight: 6,
    marginBottom: 6,
    outline: "none",
  } as React.CSSProperties,

  inpSmall: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    color: "#e1e4e8",
    padding: "4px 7px",
    fontSize: 12,
    outline: "none",
    width: "100%",
  } as React.CSSProperties,

  btn: (color = "#238636", disabled = false): React.CSSProperties => ({
    background: disabled ? "#333" : color,
    color: disabled ? "#666" : "#fff",
    border: "none",
    borderRadius: 6,
    padding: "7px 14px",
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    marginRight: 6,
    opacity: disabled ? 0.6 : 1,
  }),

  btnSm: (color = "#238636"): React.CSSProperties => ({
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: 12,
    marginRight: 4,
    whiteSpace: "nowrap" as const,
  }),

  tab: (active: boolean): React.CSSProperties => ({
    background: active ? "#1f6feb" : "#21262d",
    color: active ? "#fff" : "#8b949e",
    border: `1px solid ${active ? "#1f6feb" : "#30363d"}`,
    borderRadius: 6,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 14,
    marginRight: 8,
  }),

  th: { padding: "8px 10px", color: "#8b949e", textAlign: "left", fontWeight: 500, fontSize: 12 } as React.CSSProperties,
  td: { padding: "6px 10px", fontSize: 13, verticalAlign: "middle" } as React.CSSProperties,
  tr: { borderBottom: "1px solid #21262d" } as React.CSSProperties,
};

// ── Main component ────────────────────────────────────────────────────────
export default function AdminPanel({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState<"stats" | "services" | "reps" | "txns">("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Analytics modal
  const [analytics, setAnalytics] = useState<ServiceAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Edit state
  const [editSvcId, setEditSvcId] = useState<string | null>(null);
  const [editSvc, setEditSvc] = useState<Partial<Service>>({});
  const [editRepId, setEditRepId] = useState<number | null>(null);
  const [editRep, setEditRep] = useState<Partial<Rep>>({});

  // Create service form
  const [newSvcName, setNewSvcName] = useState("");
  const [newSvcCity, setNewSvcCity] = useState("");
  const [newSvcPhone, setNewSvcPhone] = useState("");
  const [newSvcRep, setNewSvcRep] = useState("");

  // Add credits form
  const [credSvcId, setCredSvcId] = useState("");
  const [credCredits, setCredCredits] = useState("");
  const [credNotes, setCredNotes] = useState("");
  const credAmount = credCredits ? parseInt(credCredits) * CREDIT_PRICE : 0;

  // Create rep form
  const [newRepTgId, setNewRepTgId] = useState("");
  const [newRepName, setNewRepName] = useState("");
  const [newRepUsername, setNewRepUsername] = useState("");
  const [newRepPhone, setNewRepPhone] = useState("");

  const q = (path: string) => `${API}${path}?key=${adminKey}`;

  async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function load() {
    try {
      const [s, sv, rp, tx] = await Promise.all([
        call<Stats>(q("/api/admin/stats")),
        call<{ services: Service[] }>(q("/api/admin/services")),
        call<{ reps: Rep[] }>(q("/api/admin/reps")),
        call<{ transactions: Transaction[] }>(q("/api/admin/transactions")),
      ]);
      setStats(s);
      setServices(sv.services);
      setReps(rp.reps);
      setTxns(tx.transactions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { load(); }, []);

  // ── Services CRUD ─────────────────────────────────────────────────
  async function createService() {
    if (!newSvcName.trim()) return;
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/service/create`, "POST", {
        name: newSvcName, city: newSvcCity, phone: newSvcPhone,
        rep_id: newSvcRep ? parseInt(newSvcRep) : null,
        admin_key: adminKey,
      });
      setNewSvcName(""); setNewSvcCity(""); setNewSvcPhone(""); setNewSvcRep("");
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function saveService(id: string) {
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/service/${id}?key=${adminKey}`, "PUT", {
        name: editSvc.name, city: editSvc.city, phone: editSvc.phone,
        rep_id: editSvc.rep_id ?? null, status: editSvc.status,
        admin_key: adminKey,
      });
      setEditSvcId(null);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function deleteService(id: string, name: string) {
    if (!confirm(`Удалить сервис «${name}»? Все данные будут удалены.`)) return;
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/service/${id}?key=${adminKey}`, "DELETE");
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function openAnalytics(service_id: string) {
    setAnalyticsLoading(true);
    setAnalytics(null);
    try {
      const data = await call<ServiceAnalytics>(`${API}/api/admin/service/${service_id}/analytics?key=${adminKey}`);
      setAnalytics(data);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAnalyticsLoading(false); }
  }

  // ── Reps CRUD ─────────────────────────────────────────────────────
  async function createRep() {
    if (!newRepName.trim()) { setError("Укажите имя представителя"); return; }
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/rep/create`, "POST", {
        telegram_id: newRepTgId ? parseInt(newRepTgId) : null,
        name: newRepName, username: newRepUsername, phone: newRepPhone,
        admin_key: adminKey,
      });
      setNewRepTgId(""); setNewRepName(""); setNewRepUsername(""); setNewRepPhone("");
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function saveRep(id: number) {
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/rep/${id}?key=${adminKey}`, "PUT", {
        name: editRep.name, username: editRep.username, phone: editRep.phone,
        admin_key: adminKey,
      });
      setEditRepId(null);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function deleteRep(id: number, name: string) {
    if (!confirm(`Удалить представителя «${name}»?`)) return;
    setLoading(true); setError("");
    try {
      await call(`${API}/api/admin/rep/${id}?key=${adminKey}`, "DELETE");
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // ── Credits ───────────────────────────────────────────────────────
  async function addCredits() {
    if (!credSvcId || !credCredits) return;
    setLoading(true); setError("");
    try {
      const data = await call<{ rep_commission_rub: number }>(
        `${API}/api/admin/service/credits`, "POST", {
          service_id: credSvcId, credits: parseInt(credCredits),
          amount_rub: credAmount, notes: credNotes,
          admin_key: adminKey,
        }
      );
      alert(`✅ Зачислено ${credCredits} кредитов на ${credAmount.toLocaleString("ru-RU")} ₽. Комиссия представителя: ${data.rep_commission_rub.toLocaleString("ru-RU")} ₽`);
      setCredSvcId(""); setCredCredits(""); setCredNotes("");
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // ── Analytics Modal ───────────────────────────────────────────────
  const AnalyticsModal = () => {
    if (!analytics && !analyticsLoading) return null;
    const a = analytics;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setAnalytics(null)}>
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", padding: 24 }}
          onClick={e => e.stopPropagation()}>

          {analyticsLoading && <div style={{ textAlign: "center", color: "#8b949e", padding: 40 }}>Загрузка...</div>}

          {a && <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>📊 {a.service.name} — аналитика</h2>
              <button style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 20 }} onClick={() => setAnalytics(null)}>✕</button>
            </div>

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
              {[
                { label: "Сессий", val: a.service.total_sessions, icon: "🔧" },
                { label: "Решено", val: a.cases_total, icon: "✅" },
                { label: "На проверке", val: a.cases_pending, icon: "⏳" },
                { label: "В базе", val: a.cases_approved, icon: "📚" },
              ].map(({ label, val, icon }) => (
                <div key={label} style={{ background: "#0d1117", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 20 }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px" }}>{val}</div>
                  <div style={{ color: "#8b949e", fontSize: 11 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              {/* Top brands */}
              <div style={{ background: "#0d1117", borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>🚗 Топ марок</div>
                {a.top_brands.length === 0 && <div style={{ color: "#8b949e", fontSize: 12 }}>Нет данных</div>}
                {a.top_brands.map(({ brand, count }) => (
                  <div key={brand} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, textTransform: "capitalize" }}>{brand || "—"}</span>
                    <span style={{ fontSize: 13, color: "#3fb950", fontWeight: 700 }}>{count}</span>
                  </div>
                ))}
              </div>
              {/* Top DTCs */}
              <div style={{ background: "#0d1117", borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>⚠️ Топ ошибок (DTC)</div>
                {a.top_dtcs.length === 0 && <div style={{ color: "#8b949e", fontSize: 12 }}>Нет данных</div>}
                {a.top_dtcs.map(({ dtc, count }) => (
                  <div key={dtc} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <code style={{ fontSize: 12, color: "#d29922" }}>{dtc}</code>
                    <span style={{ fontSize: 13, color: "#3fb950", fontWeight: 700 }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent cases */}
            <div style={{ background: "#0d1117", borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>📋 Последние диагностики</div>
              {a.recent_cases.length === 0 && <div style={{ color: "#8b949e", fontSize: 12 }}>Нет кейсов</div>}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "#8b949e", borderBottom: "1px solid #21262d" }}>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>Авто</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>DTC</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>Статус</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {a.recent_cases.map(c => (
                    <tr key={c.case_id} style={{ borderBottom: "1px solid #161b22" }}>
                      <td style={{ padding: "5px 8px" }}>{c.vehicle?.brand} {c.vehicle?.model} {c.vehicle?.year}</td>
                      <td style={{ padding: "5px 8px" }}>
                        {(c.dtc_codes || []).map(d => <code key={d} style={{ marginRight: 4, color: "#d29922" }}>{d}</code>)}
                        {!(c.dtc_codes?.length) && <span style={{ color: "#8b949e" }}>симптомы</span>}
                      </td>
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{ color: c.status === "approved" ? "#3fb950" : "#d29922", fontSize: 11 }}>
                          {c.status === "approved" ? "✅ в базе" : "⏳ ожидает"}
                        </span>
                      </td>
                      <td style={{ padding: "5px 8px", color: "#6e7681" }}>{new Date(c.created_at).toLocaleDateString("ru-RU")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 24, marginRight: 12 }}>⚙️</span>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>2LS — Панель администратора</h1>
        <button style={{ ...S.btn("#21262d"), marginLeft: "auto" }} onClick={load}>🔄 Обновить</button>
      </div>

      {error && (
        <div style={{ background: "#3d1a1a", border: "1px solid #da3633", borderRadius: 8, padding: 12, marginBottom: 16, color: "#f85149" }}>
          {error} <button style={{ float: "right", background: "none", border: "none", color: "#f85149", cursor: "pointer" }} onClick={() => setError("")}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ marginBottom: 24 }}>
        {(["stats", "services", "reps", "txns"] as const).map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === "stats" ? "📊 Статистика" : t === "services" ? "🏪 Сервисы" : t === "reps" ? "👥 Представители" : "💳 Транзакции"}
          </button>
        ))}
      </div>

      {/* ── STATS ── */}
      {tab === "stats" && stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {[
            { label: "Сервисов всего", val: stats.total_services, icon: "🏪" },
            { label: "Активных", val: stats.active_services, icon: "✅" },
            { label: "Выручка, ₽", val: `${stats.total_revenue_rub.toLocaleString("ru-RU")} ₽`, icon: "💰" },
            { label: "Сессий всего", val: stats.total_sessions, icon: "🔧" },
            { label: "Кредитов остаток", val: stats.total_credits_remaining, icon: "🎫" },
            { label: "Кейсов на проверку", val: stats.pending_cases, icon: "📋" },
            { label: "Долг представит., ₽", val: `${stats.total_rep_debt_rub.toLocaleString("ru-RU")} ₽`, icon: "👥" },
          ].map(({ label, val, icon }) => (
            <div key={label} style={{ ...S.card, textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>{icon}</div>
              <div style={{ fontSize: 24, fontWeight: 700, margin: "8px 0 4px" }}>{val}</div>
              <div style={{ color: "#8b949e", fontSize: 13 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── SERVICES ── */}
      {tab === "services" && (
        <div>
          {/* Create */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>➕ Добавить сервис</h3>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...S.inp, width: 200 }} placeholder="Название СТО *" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
              <input style={{ ...S.inp, width: 140 }} placeholder="Город" value={newSvcCity} onChange={e => setNewSvcCity(e.target.value)} />
              <input style={{ ...S.inp, width: 140 }} placeholder="Телефон" value={newSvcPhone} onChange={e => setNewSvcPhone(e.target.value)} />
              <select style={{ ...S.inp, width: 190 }} value={newSvcRep} onChange={e => setNewSvcRep(e.target.value)}>
                <option value="">— Без представителя —</option>
                {reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}
              </select>
              <button style={S.btn(!newSvcName.trim() ? "#555" : undefined, !newSvcName.trim())} onClick={createService} disabled={loading || !newSvcName.trim()}>Создать</button>
            </div>
          </div>

          {/* Add credits */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>💳 Добавить кредиты</h3>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
              <select style={{ ...S.inp, width: 240 }} value={credSvcId} onChange={e => setCredSvcId(e.target.value)}>
                <option value="">— Выберите сервис —</option>
                {services.map(s => <option key={s.service_id} value={s.service_id}>{s.name} ({s.city || "—"}) [{s.credits} кр.]</option>)}
              </select>
              <input style={{ ...S.inp, width: 100 }} placeholder="Кредиты" type="number" min="1" value={credCredits} onChange={e => setCredCredits(e.target.value)} />
              <div style={{ display: "inline-flex", alignItems: "center", background: "#21262d", border: "1px solid #30363d", borderRadius: 6, padding: "7px 12px", marginRight: 6, marginBottom: 6, fontSize: 13, color: credAmount > 0 ? "#3fb950" : "#8b949e", fontWeight: credAmount > 0 ? 700 : 400 }}>
                {credAmount > 0 ? `${credAmount.toLocaleString("ru-RU")} ₽` : "0 ₽"}
              </div>
              <input style={{ ...S.inp, width: 180 }} placeholder="Примечание" value={credNotes} onChange={e => setCredNotes(e.target.value)} />
              <button style={S.btn("#1f6feb")} onClick={addCredits} disabled={loading || !credSvcId || !credCredits}>Зачислить</button>
            </div>
          </div>

          {/* Table */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>🏪 Все сервисы ({services.length})</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  <th style={S.th}>Название</th>
                  <th style={S.th}>Город</th>
                  <th style={S.th}>Телефон</th>
                  <th style={S.th}>Представитель</th>
                  <th style={S.th}>Кредиты</th>
                  <th style={S.th}>Сессий</th>
                  <th style={S.th}>Статус</th>
                  <th style={S.th}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {services.map(s => (
                  editSvcId === s.service_id ? (
                    // ── Edit row ──
                    <tr key={s.service_id} style={{ ...S.tr, background: "#1c2128" }}>
                      <td style={S.td}><input style={S.inpSmall} value={editSvc.name || ""} onChange={e => setEditSvc(p => ({ ...p, name: e.target.value }))} /></td>
                      <td style={S.td}><input style={S.inpSmall} value={editSvc.city || ""} onChange={e => setEditSvc(p => ({ ...p, city: e.target.value }))} /></td>
                      <td style={S.td}><input style={S.inpSmall} value={editSvc.phone || ""} onChange={e => setEditSvc(p => ({ ...p, phone: e.target.value }))} /></td>
                      <td style={S.td}>
                        <select style={S.inpSmall} value={editSvc.rep_id ?? ""} onChange={e => setEditSvc(p => ({ ...p, rep_id: e.target.value ? parseInt(e.target.value) : null }))}>
                          <option value="">— нет —</option>
                          {reps.map(r => <option key={r.telegram_id} value={r.telegram_id}>{r.name}</option>)}
                        </select>
                      </td>
                      <td style={S.td}>{s.credits}</td>
                      <td style={S.td}>{s.total_sessions}</td>
                      <td style={S.td}>
                        <select style={S.inpSmall} value={editSvc.status || "active"} onChange={e => setEditSvc(p => ({ ...p, status: e.target.value }))}>
                          <option value="active">активен</option>
                          <option value="blocked">заблокирован</option>
                        </select>
                      </td>
                      <td style={S.td}>
                        <button style={S.btnSm("#238636")} onClick={() => saveService(s.service_id)} disabled={loading}>✓ Сохранить</button>
                        <button style={S.btnSm("#555")} onClick={() => setEditSvcId(null)}>✕</button>
                      </td>
                    </tr>
                  ) : (
                    // ── View row ──
                    <tr key={s.service_id} style={S.tr}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{s.name}<div style={{ color: "#6e7681", fontSize: 11 }}>{s.service_id}</div></td>
                      <td style={{ ...S.td, color: "#8b949e" }}>{s.city || "—"}</td>
                      <td style={{ ...S.td, color: "#8b949e" }}>{s.phone || "—"}</td>
                      <td style={{ ...S.td, color: "#8b949e" }}>{s.rep_name || "—"}</td>
                      <td style={{ ...S.td, color: s.credits > 0 ? "#3fb950" : "#f85149", fontWeight: 700 }}>{s.credits}</td>
                      <td style={S.td}>{s.total_sessions}</td>
                      <td style={S.td}>
                        <span style={{ background: s.status === "active" ? "#1a3a1a" : "#3d1a1a", color: s.status === "active" ? "#3fb950" : "#f85149", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
                          {s.status === "active" ? "✅ активен" : "🚫 блок"}
                        </span>
                      </td>
                      <td style={S.td}>
                        <button style={S.btnSm("#1f6feb")} onClick={() => { setEditSvcId(s.service_id); setEditSvc({ name: s.name, city: s.city, phone: s.phone, rep_id: s.rep_id, status: s.status }); }}>✏️</button>
                        <button style={S.btnSm("#238636")} onClick={() => openAnalytics(s.service_id)}>📊</button>
                        <button style={S.btnSm("#b62324")} onClick={() => deleteService(s.service_id, s.name)}>🗑</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── REPS ── */}
      {tab === "reps" && (
        <div>
          {/* Create */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>➕ Добавить представителя</h3>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...S.inp, width: 180 }} placeholder="Имя *" value={newRepName} onChange={e => setNewRepName(e.target.value)} />
              <input style={{ ...S.inp, width: 140 }} placeholder="@username" value={newRepUsername} onChange={e => setNewRepUsername(e.target.value)} />
              <input style={{ ...S.inp, width: 140 }} placeholder="Телефон" value={newRepPhone} onChange={e => setNewRepPhone(e.target.value)} />
              <input style={{ ...S.inp, width: 140 }} placeholder="Telegram ID (если есть)" value={newRepTgId} onChange={e => setNewRepTgId(e.target.value)} />
              <button style={S.btn(!newRepName.trim() ? "#555" : undefined, !newRepName.trim())} onClick={createRep} disabled={loading || !newRepName.trim()}>
                {loading ? "..." : "Добавить"}
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>👥 Представители ({reps.length})</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  <th style={S.th}>Имя</th>
                  <th style={S.th}>Telegram</th>
                  <th style={S.th}>Телефон</th>
                  <th style={S.th}>Сервисов</th>
                  <th style={S.th}>Заработано</th>
                  <th style={S.th}>К выплате</th>
                  <th style={S.th}>Ссылка / Токен</th>
                  <th style={S.th}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {reps.map(r => (
                  editRepId === r.telegram_id ? (
                    // ── Edit row ──
                    <tr key={r.telegram_id} style={{ ...S.tr, background: "#1c2128" }}>
                      <td style={S.td}><input style={S.inpSmall} value={editRep.name || ""} onChange={e => setEditRep(p => ({ ...p, name: e.target.value }))} /></td>
                      <td style={S.td}><input style={{ ...S.inpSmall, width: 120 }} placeholder="@username" value={editRep.username || ""} onChange={e => setEditRep(p => ({ ...p, username: e.target.value }))} /></td>
                      <td style={S.td}><input style={S.inpSmall} value={editRep.phone || ""} onChange={e => setEditRep(p => ({ ...p, phone: e.target.value }))} /></td>
                      <td style={S.td}>{r.services_count}</td>
                      <td style={S.td}>${r.total_earned_usd.toFixed(2)}</td>
                      <td style={S.td}>${r.pending_payout_usd.toFixed(2)}</td>
                      <td style={S.td} />
                      <td style={S.td}>
                        <button style={S.btnSm("#238636")} onClick={() => saveRep(r.telegram_id)} disabled={loading}>✓ Сохранить</button>
                        <button style={S.btnSm("#555")} onClick={() => setEditRepId(null)}>✕</button>
                      </td>
                    </tr>
                  ) : (
                    // ── View row ──
                    <tr key={r.telegram_id} style={S.tr}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{r.name}</td>
                      <td style={{ ...S.td, color: "#8b949e" }}>@{r.username || "—"}</td>
                      <td style={{ ...S.td, color: "#8b949e" }}>{r.phone || "—"}</td>
                      <td style={S.td}>{r.services_count}</td>
                      <td style={{ ...S.td, color: "#3fb950" }}>{(r.total_earned_rub || 0).toLocaleString("ru-RU")} ₽</td>
                      <td style={{ ...S.td, color: (r.pending_payout_rub || 0) > 0 ? "#d29922" : "#8b949e", fontWeight: (r.pending_payout_rub || 0) > 0 ? 700 : 400 }}>
                        {(r.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽
                      </td>
                      <td style={S.td}>
                        <button
                          style={S.btnSm("#21262d")}
                          onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?rep_token=${r.rep_token}`); }}
                        >
                          📋 Ссылка
                        </button>
                        <code style={{ fontSize: 10, color: "#6e7681" }}>{r.rep_token}</code>
                      </td>
                      <td style={S.td}>
                        <button style={S.btnSm("#1f6feb")} onClick={() => { setEditRepId(r.telegram_id); setEditRep({ name: r.name, username: r.username, phone: r.phone }); }}>✏️ Изменить</button>
                        <button style={S.btnSm("#b62324")} onClick={() => deleteRep(r.telegram_id, r.name)}>🗑 Удалить</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnalyticsModal />

      {/* ── TRANSACTIONS ── */}
      {tab === "txns" && (
        <div style={S.card}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>💳 Последние транзакции</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d" }}>
                <th style={S.th}>Дата</th>
                <th style={S.th}>Сервис</th>
                <th style={S.th}>Кредиты</th>
                <th style={S.th}>Сумма, $</th>
                <th style={S.th}>Комиссия, $</th>
                <th style={S.th}>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.txn_id} style={S.tr}>
                  <td style={{ ...S.td, color: "#8b949e" }}>{new Date(t.created_at).toLocaleString("ru-RU")}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{t.service_name}</td>
                  <td style={{ ...S.td, color: "#3fb950" }}>+{t.credits_added}</td>
                  <td style={S.td}>{(t.amount_rub || 0).toLocaleString("ru-RU")} ₽</td>
                  <td style={{ ...S.td, color: "#d29922" }}>{(t.rep_commission_rub || 0).toLocaleString("ru-RU")} ₽</td>
                  <td style={{ ...S.td, color: "#8b949e" }}>{t.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
