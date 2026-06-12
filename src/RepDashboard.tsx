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

const C = {
  bg: "#f8fafc", surface: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", textSub: "#64748b", textMuted: "#94a3b8",
  blue: "#2563eb", blueBg: "#eff6ff", blueBorder: "#bfdbfe",
  green: "#16a34a", greenBg: "#f0fdf4",
  amber: "#d97706", amberBg: "#fffbeb",
  red: "#dc2626", redBg: "#fef2f2",
  emerald: "#059669", emeraldBg: "#ecfdf5", emeraldBorder: "#6ee7b7",
};

export default function RepDashboard({ repToken }: { repToken: string }) {
  const [rep, setRep] = useState<Rep | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/rep/dashboard?token=${repToken}`)
      .then(r => { if (!r.ok) throw new Error("Неверная ссылка или токен истёк"); return r.json(); })
      .then(data => { setRep(data.rep); setServices(data.services); setTxns(data.recent_transactions); })
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
        <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin .7s linear infinite", margin: "0 auto 14px" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ color: C.textSub, fontSize: 14 }}>Загрузка кабинета...</div>
      </div>
    </div>
  );

  const totalSessions = services.reduce((a, s) => a + s.total_sessions, 0);
  const totalRevenue = services.reduce((a, s) => a + (s.total_paid_rub || 0), 0);
  const myShare = totalRevenue * (rep.commission_rate || 0.1);

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 };
  const th: React.CSSProperties = { padding: "10px 14px", color: C.textSub, textAlign: "left", fontWeight: 600, fontSize: 12, borderBottom: `2px solid ${C.border}` };
  const td: React.CSSProperties = { padding: "10px 14px", fontSize: 13, borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" };

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>

      {/* Top bar */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 14, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: 32, height: 32, background: C.emerald, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>2L</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, lineHeight: 1.2 }}>{rep.name}</div>
          <div style={{ fontSize: 12, color: C.textSub }}>{rep.username ? `@${rep.username} · ` : ""}Представитель 2LS · {Math.round((rep.commission_rate || 0.1) * 100)}% комиссия</div>
        </div>
      </div>

      <div style={{ padding: "28px", maxWidth: 960, margin: "0 auto" }}>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14, marginBottom: 20 }}>
          {[
            { icon: "🏪", label: "Подключено сервисов", val: services.length, color: C.blue, bg: C.blueBg, border: C.blueBorder },
            { icon: "🔧", label: "Диагностик всего", val: totalSessions, color: C.text, bg: C.surface, border: C.border },
            { icon: "💰", label: "Моя выручка", val: `${(rep.total_earned_rub || 0).toLocaleString("ru-RU")} ₽`, color: C.emerald, bg: C.emeraldBg, border: C.emeraldBorder },
            { icon: "⏳", label: "К выплате", val: `${(rep.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽`, color: (rep.pending_payout_rub || 0) > 0 ? C.amber : C.textSub, bg: (rep.pending_payout_rub || 0) > 0 ? C.amberBg : C.surface, border: (rep.pending_payout_rub || 0) > 0 ? "#fde68a" : C.border },
          ].map(({ icon, label, val, color, bg, border }) => (
            <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "18px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color, marginBottom: 4 }}>{val}</div>
              <div style={{ color: C.textSub, fontSize: 12 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Revenue insight */}
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBorder}`, borderRadius: 12, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 20 }}>📈</div>
          <div style={{ fontSize: 13, color: C.textSub }}>
            Общая выручка ваших сервисов:
            <strong style={{ color: C.text, marginLeft: 6 }}>{totalRevenue.toLocaleString("ru-RU")} ₽</strong>
            <span style={{ margin: "0 6px", color: C.textMuted }}>·</span>
            Ваша доля {Math.round((rep.commission_rate || 0.1) * 100)}%:
            <strong style={{ color: C.emerald, marginLeft: 6 }}>{myShare.toLocaleString("ru-RU")} ₽</strong>
          </div>
        </div>

        {/* Services */}
        <div style={card}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: C.text }}>Ваши автосервисы</h3>
          {services.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: C.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏪</div>
              Пока нет подключённых сервисов
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Название</th><th style={th}>Город</th><th style={th}>Кредиты</th>
                  <th style={th}>Диагностик</th><th style={th}>Оплачено</th><th style={th}>Ваша доля</th><th style={th}>Статус</th>
                </tr></thead>
                <tbody>{services.map(s => (
                  <tr key={s.service_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                    <td style={{ ...td, color: C.textSub }}>{s.city || "—"}</td>
                    <td style={{ ...td, color: s.credits > 0 ? C.green : C.red, fontWeight: 700 }}>{s.credits}</td>
                    <td style={td}>{s.total_sessions}</td>
                    <td style={td}>{(s.total_paid_rub || 0).toLocaleString("ru-RU")} ₽</td>
                    <td style={{ ...td, color: C.emerald, fontWeight: 600 }}>{((s.total_paid_rub || 0) * (rep.commission_rate || 0.1)).toLocaleString("ru-RU")} ₽</td>
                    <td style={td}>
                      <span style={{ background: s.status === "active" ? C.emeraldBg : C.redBg, color: s.status === "active" ? C.emerald : C.red, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                        {s.status === "active" ? "активен" : "заблокирован"}
                      </span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        {/* Transactions */}
        {txns.length > 0 && (
          <div style={card}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: C.text }}>Последние пополнения</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Дата</th><th style={th}>Сервис</th><th style={th}>Кредиты</th><th style={th}>Сумма</th><th style={th}>Ваша доля</th>
                </tr></thead>
                <tbody>{txns.map(t => (
                  <tr key={t.txn_id} onMouseEnter={e => (e.currentTarget.style.background = C.bg)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <td style={{ ...td, color: C.textSub, fontSize: 12 }}>{new Date(t.created_at).toLocaleString("ru-RU")}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{t.service_name}</td>
                    <td style={{ ...td, color: C.green, fontWeight: 700 }}>+{t.credits_added}</td>
                    <td style={td}>{(t.amount_rub || 0).toLocaleString("ru-RU")} ₽</td>
                    <td style={{ ...td, color: C.emerald, fontWeight: 700 }}>{(t.rep_commission_rub || 0).toLocaleString("ru-RU")} ₽</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", color: C.textMuted, fontSize: 12, marginTop: 24 }}>
          2LS · Личный кабинет представителя
        </div>
      </div>
    </div>
  );
}
