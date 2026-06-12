import React, { useState, useEffect } from "react";

const API = "";

interface Rep {
  telegram_id: number;
  name: string;
  username: string;
  phone: string;
  commission_rate: number;
  total_earned_rub: number;
  pending_payout_rub: number;
}

interface Service {
  service_id: string;
  name: string;
  city: string;
  phone: string;
  credits: number;
  total_sessions: number;
  total_paid_rub: number;
  status: string;
  created_at: string;
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

export default function RepDashboard({ repToken }: { repToken: string }) {
  const [rep, setRep] = useState<Rep | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/rep/dashboard?token=${repToken}`)
      .then((r) => {
        if (!r.ok) throw new Error("Неверная ссылка или токен истёк");
        return r.json();
      })
      .then((data) => {
        setRep(data.rep);
        setServices(data.services);
        setTxns(data.recent_transactions);
      })
      .catch((e) => setError(e.message));
  }, [repToken]);

  const s: React.CSSProperties = {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "#0f1117",
    minHeight: "100vh",
    color: "#e1e4e8",
    padding: "24px",
    maxWidth: 900,
    margin: "0 auto",
  };

  const card: React.CSSProperties = {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  };

  if (error) {
    return (
      <div style={s}>
        <div style={{ textAlign: "center", paddingTop: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ color: "#f85149", fontSize: 16 }}>{error}</div>
          <div style={{ color: "#8b949e", marginTop: 8 }}>Обратитесь к администратору 2LS</div>
        </div>
      </div>
    );
  }

  if (!rep) {
    return (
      <div style={s}>
        <div style={{ textAlign: "center", paddingTop: 80, color: "#8b949e" }}>Загрузка...</div>
      </div>
    );
  }

  const totalSessions = services.reduce((acc, s) => acc + s.total_sessions, 0);
  const totalRevenue = services.reduce((acc, s) => acc + (s.total_paid_rub || 0), 0);

  return (
    <div style={s}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg, #1f6feb, #388bfd)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, fontWeight: 700, color: "#fff",
        }}>
          {rep.name[0]}
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{rep.name}</h1>
          <div style={{ color: "#8b949e", fontSize: 14 }}>
            {rep.username ? `@${rep.username}` : ""} · Представитель 2LS · {Math.round(rep.commission_rate * 100)}% комиссия
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { icon: "🏪", label: "Подключено сервисов", val: services.length },
          { icon: "🔧", label: "Диагностик всего", val: totalSessions },
          { icon: "💰", label: "Моя выручка", val: `${(rep.total_earned_rub || 0).toLocaleString("ru-RU")} ₽` },
          { icon: "⏳", label: "К выплате", val: `${(rep.pending_payout_rub || 0).toLocaleString("ru-RU")} ₽`, highlight: (rep.pending_payout_rub || 0) > 0 },
        ].map(({ icon, label, val, highlight }) => (
          <div key={label} style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 28 }}>{icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, margin: "8px 0 4px", color: highlight ? "#d29922" : "#e1e4e8" }}>{val}</div>
            <div style={{ color: "#8b949e", fontSize: 13 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Revenue hint */}
      <div style={{ ...card, background: "#111d2c", borderColor: "#1f4068", marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: "#8b949e" }}>
          💡 Общая выручка ваших сервисов: <strong style={{ color: "#e1e4e8" }}>{totalRevenue.toLocaleString("ru-RU")} ₽</strong>
          {" "}· Ваша доля 10%: <strong style={{ color: "#3fb950" }}>{(totalRevenue * 0.1).toLocaleString("ru-RU")} ₽</strong>
        </div>
      </div>

      {/* Services list */}
      <div style={card}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>🏪 Ваши автосервисы</h3>
        {services.length === 0 ? (
          <div style={{ color: "#8b949e", textAlign: "center", padding: 24 }}>
            Пока нет подключённых сервисов
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d", color: "#8b949e", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Название</th>
                <th style={{ padding: "8px 12px" }}>Город</th>
                <th style={{ padding: "8px 12px" }}>Кредиты</th>
                <th style={{ padding: "8px 12px" }}>Диагностик</th>
                <th style={{ padding: "8px 12px" }}>Оплачено, ₽</th>
                <th style={{ padding: "8px 12px" }}>Ваша доля, ₽</th>
                <th style={{ padding: "8px 12px" }}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.service_id} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: "8px 12px", color: "#8b949e" }}>{s.city || "—"}</td>
                  <td style={{ padding: "8px 12px", color: s.credits > 0 ? "#3fb950" : "#f85149", fontWeight: 700 }}>{s.credits}</td>
                  <td style={{ padding: "8px 12px" }}>{s.total_sessions}</td>
                  <td style={{ padding: "8px 12px" }}>{(s.total_paid_rub || 0).toLocaleString("ru-RU")} ₽</td>
                  <td style={{ padding: "8px 12px", color: "#d29922" }}>{((s.total_paid_rub || 0) * 0.1).toLocaleString("ru-RU")} ₽</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      background: s.status === "active" ? "#1a3a1a" : "#3d1a1a",
                      color: s.status === "active" ? "#3fb950" : "#f85149",
                      padding: "2px 8px", borderRadius: 4, fontSize: 11
                    }}>
                      {s.status === "active" ? "✅ активен" : "🚫 заблокирован"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent transactions */}
      {txns.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>💳 Последние пополнения</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d", color: "#8b949e", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Дата</th>
                <th style={{ padding: "8px 12px" }}>Сервис</th>
                <th style={{ padding: "8px 12px" }}>Кредиты</th>
                <th style={{ padding: "8px 12px" }}>Сумма</th>
                <th style={{ padding: "8px 12px" }}>Ваша доля</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.txn_id} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "8px 12px", color: "#8b949e" }}>{new Date(t.created_at).toLocaleString("ru-RU")}</td>
                  <td style={{ padding: "8px 12px" }}>{t.service_name}</td>
                  <td style={{ padding: "8px 12px", color: "#3fb950" }}>+{t.credits_added}</td>
                  <td style={{ padding: "8px 12px" }}>{(t.amount_rub || 0).toLocaleString("ru-RU")} ₽</td>
                  <td style={{ padding: "8px 12px", color: "#d29922", fontWeight: 600 }}>{(t.rep_commission_rub || 0).toLocaleString("ru-RU")} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ textAlign: "center", color: "#6e7681", fontSize: 12, marginTop: 32 }}>
        2LS · Личный кабинет представителя
      </div>
    </div>
  );
}
