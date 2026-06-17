import React, { useState, useEffect } from "react";

const API = "";

interface Rep {
  telegram_id: number; name: string; username: string; phone: string;
  commission_rate: number; total_earned_rub: number; pending_payout_rub: number;
}
interface Service {
  service_id: string; name: string; city: string; phone: string;
  credits: number; total_sessions: number; total_paid_rub: number;
  status: string; created_at: string;
}
interface Transaction {
  txn_id: string; service_name: string; amount_rub: number;
  credits_added: number; rep_commission_rub: number; notes: string; created_at: string;
}
interface SuspiciousSession {
  session_id: string; service_id: string; service_name: string;
  status: string; credit_hold: string; created_at: string;
  vehicle?: { brand?: string; model?: string; year?: string };
}

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
  emerald: "#059669",
  emeraldBg: "#ecfdf5",
  emeraldBorder: "#6ee7b7",
};

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "9px 12px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const, ...extra };
}

const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const tdX: React.CSSProperties = { padding: "2px 7px", fontSize: 11, verticalAlign: "middle", borderBottom: `1px solid ${C.border}`, lineHeight: "1.3", whiteSpace: "nowrap" as const };
const thX: React.CSSProperties = { padding: "4px 7px", color: C.textSub, textAlign: "left" as const, fontWeight: 600, fontSize: 10, borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap" as const };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.textMuted, flexShrink: 0, marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text, fontWeight: 500, textAlign: "right" }}>{children}</span>
    </div>
  );
}

export default function RepDashboard({ repToken, onLogout }: { repToken: string; onLogout?: () => void }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [rep, setRep] = useState<Rep | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousSession[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/rep/dashboard?token=${repToken}`)
      .then(r => { if (!r.ok) throw new Error("Неверная ссылка или токен истёк"); return r.json(); })
      .then(data => {
        setRep(data.rep);
        setServices(data.services);
        setTxns(data.recent_transactions);
        setSuspicious(data.suspicious_sessions || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [repToken]);

  if (error) return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 48, maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ color: C.red, fontWeight: 600, fontSize: 15, marginBottom: 8 }}>{error}</div>
        <div style={{ color: C.textSub, fontSize: 13 }}>Обратитесь к администратору 2LS</div>
      </div>
    </div>
  );

  if (loading || !rep) return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTopColor: C.emerald, borderRadius: "50%", animation: "spin .7s linear infinite", margin: "0 auto 14px" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ color: C.textSub, fontSize: 14 }}>Загрузка кабинета...</div>
      </div>
    </div>
  );

  const totalRevenue = services.reduce((a, s) => a + (s.total_paid_rub || 0), 0);
  const totalSessions = services.reduce((a, s) => a + s.total_sessions, 0);
  const myShare = totalRevenue * (rep.commission_rate || 0.1);

  async function deleteSession(sessionId: string) {
    setDeleteConfirm({ message: "Удалить брошенную сессию?", action: async () => {
      try {
        const r = await fetch(`${API}/api/rep/session/${sessionId}?token=${encodeURIComponent(repToken)}`, { method: "DELETE" });
        if (!r.ok) throw new Error(await r.text());
        setSuspicious(prev => prev.filter(s => s.session_id !== sessionId));
      } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    }});
  }

  const openInBrowser = () => {
    const tg = (window as any).Telegram?.WebApp;
    const url = `${window.location.origin}${window.location.pathname}?rep_token=${encodeURIComponent(repToken)}`;
    if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank");
  };

  const zoomStyle: React.CSSProperties = !isMobile ? {
    zoom: 1.7,
    width: "calc(100vw / 1.7)",
    minHeight: "calc(100vh / 1.7)",
  } : {};

  const pad = isMobile ? "12px 16px" : "24px 28px";

  const ConfirmModal = () => {
    if (!deleteConfirm) return null;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setDeleteConfirm(null)}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, boxShadow: "0 16px 48px rgba(0,0,0,.18)" }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>🗑</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, textAlign: "center", marginBottom: 6 }}>Подтверждение</div>
          <div style={{ fontSize: 13, color: C.textSub, textAlign: "center", marginBottom: 24 }}>{deleteConfirm.message}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }} onClick={() => setDeleteConfirm(null)}>Отмена</button>
            <button style={{ flex: 1, background: C.red, border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#fff" }} onClick={async () => { const a = deleteConfirm.action; setDeleteConfirm(null); await a(); }}>Удалить</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      <div style={zoomStyle}>

        {/* ── Top bar (desktop only) ── */}
        {!isMobile && (
          <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ width: 30, height: 30, background: C.emerald, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>2LS</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, lineHeight: 1.2 }}>{rep.name}</div>
              <div style={{ fontSize: 11, color: C.textSub }}>{rep.username ? `@${rep.username} · ` : ""}Представитель · {Math.round((rep.commission_rate || 0.1) * 100)}% комиссия</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={openInBrowser} title="Открыть в браузере"
                style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 15 }}>🖥</button>
              {onLogout && (
                <button onClick={onLogout}
                  style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.red }}>
                  Выйти
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: pad, maxWidth: 1200, margin: "0 auto", paddingBottom: isMobile ? "80px" : pad }}>

          {/* ── KPI cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 14 : 16 }}>
            {[
              { icon: "🏪", label: "Сервисов", val: services.length, color: C.blue },
              { icon: "🔧", label: "Диагностик", val: totalSessions, color: C.text },
              { icon: "💰", label: "Заработано", val: `${(rep.total_earned_rub || 0).toLocaleString("ru-RU")} ₽`, color: C.emerald },
              { icon: "⏳", label: "К выплате", val: `${(rep.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽`, color: (rep.pending_payout_rub || 0) > 0 ? C.amber : C.textSub },
            ].map(({ icon, label, val, color }) => (
              <div key={label} style={{ ...card, textAlign: "center", marginBottom: 0, padding: isMobile ? 16 : "4px 8px" }}>
                <div style={{ fontSize: isMobile ? 20 : 13, marginBottom: isMobile ? 4 : 2 }}>{icon}</div>
                <div style={{ fontSize: isMobile ? 16 : 12, fontWeight: 800, color, marginBottom: isMobile ? 2 : 1 }}>{val}</div>
                <div style={{ color: C.textSub, fontSize: isMobile ? 11 : 9 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* ── Revenue insight ── */}
          <div style={{ background: C.blueBg, border: `1px solid ${C.blue}`, borderRadius: 12, padding: isMobile ? "10px 14px" : "5px 10px", marginBottom: isMobile ? 14 : 16, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: isMobile ? 18 : 14 }}>📈</div>
            <div style={{ fontSize: isMobile ? 12 : 11, color: C.textSub, lineHeight: 1.4 }}>
              Выручка сервисов: <strong style={{ color: C.text }}>{totalRevenue.toLocaleString("ru-RU")} ₽</strong>
              <span style={{ margin: "0 6px", color: C.textMuted }}>·</span>
              Ваша доля {Math.round((rep.commission_rate || 0.1) * 100)}%: <strong style={{ color: C.emerald }}>{myShare.toLocaleString("ru-RU")} ₽</strong>
            </div>
          </div>

          {/* ── Services ── */}
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 6 }}>Ваши автосервисы ({services.length})</div>
          {services.length === 0 ? (
            <div style={{ ...card, textAlign: "center", padding: "32px 0", color: C.textMuted }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🏪</div>Пока нет подключённых сервисов
            </div>
          ) : isMobile ? (
            services.map(s => (
              <div key={s.service_id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
                  <span style={{ background: s.status === "active" ? C.emeraldBg : C.redBg, color: s.status === "active" ? C.emerald : C.red, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {s.status === "active" ? "активен" : "заблок"}
                  </span>
                </div>
                <Row label="Город">{s.city || "—"}</Row>
                <Row label="Кредиты"><span style={{ color: s.credits > 0 ? C.green : C.red, fontWeight: 700 }}>{s.credits}</span></Row>
                <Row label="Диагностик">{s.total_sessions}</Row>
                <Row label="Оплачено">{(s.total_paid_rub || 0).toLocaleString("ru-RU")} ₽</Row>
                <Row label="Ваша доля"><span style={{ color: C.emerald, fontWeight: 600 }}>{((s.total_paid_rub || 0) * (rep.commission_rate || 0.1)).toLocaleString("ru-RU")} ₽</span></Row>
              </div>
            ))
          ) : (
            <div style={card}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Название", "Город", "Кредиты", "Диагностик", "Оплачено", "Ваша доля", "Статус"].map(h => <th key={h} style={thX}>{h}</th>)}</tr></thead>
                  <tbody>{services.map(s => (
                    <tr key={s.service_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={{ ...tdX, fontWeight: 600 }}>{s.name}</td>
                      <td style={{ ...tdX, color: C.textSub }}>{s.city || "—"}</td>
                      <td style={{ ...tdX, color: s.credits > 0 ? C.green : C.red, fontWeight: 700 }}>{s.credits}</td>
                      <td style={tdX}>{s.total_sessions}</td>
                      <td style={tdX}>{(s.total_paid_rub || 0).toLocaleString("ru-RU")} ₽</td>
                      <td style={{ ...tdX, color: C.emerald, fontWeight: 600 }}>{((s.total_paid_rub || 0) * (rep.commission_rate || 0.1)).toLocaleString("ru-RU")} ₽</td>
                      <td style={tdX}><span style={{ background: s.status === "active" ? C.emeraldBg : C.redBg, color: s.status === "active" ? C.emerald : C.red, padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{s.status === "active" ? "активен" : "заблок"}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Suspicious sessions ── */}
          {suspicious.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.amber, marginBottom: 6, marginTop: 4 }}>⚠️ Сессии без закрытия ({suspicious.length})</div>
              <div style={{ color: C.textSub, fontSize: 12, marginBottom: 8 }}>Открыты механиком, но не завершены. Кредит не списан.</div>
              {isMobile ? (
                suspicious.map(s => {
                  const vehicleStr = s.vehicle ? [s.vehicle.brand, s.vehicle.model, s.vehicle.year].filter(Boolean).join(" ") || "—" : "—";
                  return (
                    <div key={s.session_id} style={{ ...card, background: C.amberBg, borderColor: "#fde68a" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{s.service_name}</div>
                        <button onClick={() => deleteSession(s.session_id)} style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.red, flexShrink: 0 }}>🗑 Удалить</button>
                      </div>
                      <Row label="Авто">{vehicleStr}</Row>
                      <Row label="Дата">{new Date(s.created_at).toLocaleString("ru-RU")}</Row>
                      <Row label="Статус"><span style={{ color: s.status === "abandoned" ? C.red : C.amber, fontWeight: 600 }}>{s.status === "abandoned" ? "брошена" : "активна >2ч"}</span></Row>
                      <Row label="Кредит">{s.credit_hold || "—"}</Row>
                    </div>
                  );
                })
              ) : (
                <div style={{ ...card, background: C.amberBg, borderColor: "#fde68a" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Дата", "Сервис", "Авто", "Статус", "Кредит", ""].map(h => <th key={h} style={{ ...thX, borderBottomColor: "#fde68a" }}>{h}</th>)}</tr></thead>
                      <tbody>{suspicious.map(s => {
                        const vehicleStr = s.vehicle ? [s.vehicle.brand, s.vehicle.model, s.vehicle.year].filter(Boolean).join(" ") || "—" : "—";
                        const isAbandoned = s.status === "abandoned";
                        return (
                          <tr key={s.session_id} onMouseEnter={e => (e.currentTarget.style.background = "#fef9c3")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                            <td style={{ ...tdX, color: C.textSub }}>{new Date(s.created_at).toLocaleString("ru-RU")}</td>
                            <td style={{ ...tdX, fontWeight: 600 }}>{s.service_name}</td>
                            <td style={{ ...tdX, color: C.textSub }}>{vehicleStr}</td>
                            <td style={tdX}><span style={{ background: isAbandoned ? "#fee2e2" : "#fef9c3", color: isAbandoned ? C.red : C.amber, padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{isAbandoned ? "брошена" : "активна >2ч"}</span></td>
                            <td style={{ ...tdX, color: C.textSub }}>{s.credit_hold || "—"}</td>
                            <td style={tdX}><button onClick={() => deleteSession(s.session_id)} style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 4, padding: "1px 6px", cursor: "pointer", fontSize: 10, fontWeight: 600, color: C.red }}>🗑</button></td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Transactions ── */}
          {txns.length > 0 && (<>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 6, marginTop: 4 }}>Последние пополнения ({txns.length})</div>
            {isMobile ? (
              txns.map(t => (
                <div key={t.txn_id} style={card}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{t.service_name}</div>
                  <Row label="Дата">{new Date(t.created_at).toLocaleString("ru-RU")}</Row>
                  <Row label="Кредиты"><span style={{ color: C.green, fontWeight: 700 }}>+{t.credits_added}</span></Row>
                  <Row label="Сумма">{(t.amount_rub || 0).toLocaleString("ru-RU")} ₽</Row>
                  <Row label="Ваша доля"><span style={{ color: C.emerald, fontWeight: 700 }}>{(t.rep_commission_rub || 0).toLocaleString("ru-RU")} ₽</span></Row>
                </div>
              ))
            ) : (
              <div style={card}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Дата", "Сервис", "Кр.", "Сумма", "Ваша доля"].map(h => <th key={h} style={thX}>{h}</th>)}</tr></thead>
                    <tbody>{txns.map(t => (
                      <tr key={t.txn_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ ...tdX, color: C.textSub }}>{new Date(t.created_at).toLocaleString("ru-RU")}</td>
                        <td style={{ ...tdX, fontWeight: 600 }}>{t.service_name}</td>
                        <td style={{ ...tdX, color: C.green, fontWeight: 700 }}>+{t.credits_added}</td>
                        <td style={tdX}>{(t.amount_rub || 0).toLocaleString("ru-RU")} ₽</td>
                        <td style={{ ...tdX, color: C.emerald, fontWeight: 700 }}>{(t.rep_commission_rub || 0).toLocaleString("ru-RU")} ₽</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </>)}

          <div style={{ textAlign: "center", color: C.textMuted, fontSize: 11, marginTop: 16 }}>2LS · Личный кабинет представителя</div>

        </div>{/* /content */}

        <ConfirmModal />

        {/* ── Bottom toolbar (mobile only) ── */}
        {isMobile && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, zIndex: 20, boxShadow: "0 -4px 16px rgba(0,0,0,.06)" }}>
            <div style={{ width: 30, height: 30, background: C.emerald, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>2LS</div>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rep.name}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              {loading && <span style={{ fontSize: 11, color: C.textMuted }}>...</span>}
              <button onClick={openInBrowser} title="Открыть в браузере"
                style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 15 }}>🖥</button>
              {onLogout && (
                <button onClick={onLogout}
                  style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.red }}>
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
