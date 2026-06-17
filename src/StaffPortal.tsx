import React, { useState } from "react";
import { Shield, Users, Eye, EyeOff, ArrowLeft, Loader2, Wrench, LogOut } from "lucide-react";
import AdminPanel from "./AdminPanel";
import RepDashboard from "./RepDashboard";

type Role = "admin" | "rep" | null;
type AuthState = { role: "admin"; key: string } | { role: "rep"; token: string } | null;

function getStoredAuth(): AuthState {
  try {
    const adminKey = sessionStorage.getItem("2ls_admin_key");
    if (adminKey) return { role: "admin", key: adminKey };
    const repToken = sessionStorage.getItem("2ls_rep_token");
    if (repToken) return { role: "rep", token: repToken };
  } catch { /* ignore */ }
  return null;
}

export default function StaffPortal() {
  const [auth, setAuth] = useState<AuthState>(getStoredAuth);
  const [role, setRole] = useState<Role>(null);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function logout() {
    sessionStorage.removeItem("2ls_admin_key");
    sessionStorage.removeItem("2ls_rep_token");
    setAuth(null);
    setRole(null);
    setPassword("");
  }

  async function handleLogin() {
    if (!password.trim() || !role) return;
    setLoading(true);
    setError("");
    try {
      if (role === "admin") {
        const r = await fetch(`/api/admin/stats?key=${encodeURIComponent(password)}`);
        if (!r.ok) throw new Error("Неверный пароль");
        sessionStorage.setItem("2ls_admin_key", password);
        setAuth({ role: "admin", key: password });
      } else {
        const r = await fetch(`/api/rep/dashboard?token=${encodeURIComponent(password)}`);
        if (!r.ok) throw new Error("Неверный токен представителя");
        sessionStorage.setItem("2ls_rep_token", password);
        setAuth({ role: "rep", token: password });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  }

  // ── Authenticated — show panel + logout button ────────────────────
  if (auth) {
    return (
      <div className="relative">
        <button
          onClick={logout}
          className="fixed top-3 right-3 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 backdrop-blur-sm text-slate-300 hover:text-white text-xs border border-slate-700 hover:border-slate-500 transition-all shadow-lg"
        >
          <LogOut className="w-3.5 h-3.5" />
          Выйти
        </button>
        {auth.role === "admin"
          ? <AdminPanel adminKey={auth.key} />
          : <RepDashboard repToken={auth.token} />
        }
      </div>
    );
  }

  // ── Role selection ────────────────────────────────────────────────
  if (!role) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-3 shadow-xl shadow-blue-900/60">
              <Wrench className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">2LS</h1>
            <p className="text-slate-400 text-sm mt-1">Портал сотрудников</p>
          </div>

          {/* Role cards */}
          <div className="space-y-3">
            <button
              onClick={() => setRole("admin")}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-800 border border-slate-700 hover:border-blue-500 hover:bg-slate-800/80 transition-all text-left group"
            >
              <div className="w-11 h-11 rounded-xl bg-blue-900/60 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-800/60 transition-colors">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-white font-semibold text-sm">Администратор</div>
                <div className="text-slate-400 text-xs mt-0.5">Управление сервисами и базой знаний</div>
              </div>
            </button>

            <button
              onClick={() => setRole("rep")}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-800 border border-slate-700 hover:border-emerald-500 hover:bg-slate-800/80 transition-all text-left group"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-900/60 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-800/60 transition-colors">
                <Users className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-white font-semibold text-sm">Представитель</div>
                <div className="text-slate-400 text-xs mt-0.5">Личный кабинет и статистика продаж</div>
              </div>
            </button>
          </div>

          <p className="text-center text-slate-600 text-xs mt-6">
            Доступ только для авторизованных сотрудников 2LS
          </p>
        </div>
      </div>
    );
  }

  // ── Login form ────────────────────────────────────────────────────
  const isAdmin = role === "admin";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Back */}
        <button
          onClick={() => { setRole(null); setPassword(""); setError(""); }}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-6 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад
        </button>

        {/* Header */}
        <div className="text-center mb-5">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3 shadow-xl ${isAdmin ? "bg-blue-900/60 shadow-blue-900/40" : "bg-emerald-900/60 shadow-emerald-900/40"}`}>
            {isAdmin
              ? <Shield className="w-6 h-6 text-blue-400" />
              : <Users className="w-6 h-6 text-emerald-400" />
            }
          </div>
          <h2 className="text-xl font-bold text-white">
            {isAdmin ? "Администратор" : "Представитель"}
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {isAdmin ? "Введите пароль для доступа" : "Введите ваш токен доступа"}
          </p>
        </div>

        {/* Form card */}
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-5 backdrop-blur-sm">
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder={isAdmin ? "Пароль администратора" : "Токен представителя"}
              className="w-full bg-slate-900 text-white rounded-xl px-4 py-3 pr-12 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm placeholder-slate-500 transition-colors"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 text-red-400 text-sm bg-red-950/50 rounded-xl px-3 py-2.5 border border-red-900/50">
              <span className="mt-0.5 flex-shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            className={`w-full mt-4 py-3 rounded-xl font-semibold text-white text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
              isAdmin
                ? "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/40"
                : "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/40"
            }`}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Проверка...</>
              : "Войти"
            }
          </button>
        </div>
      </div>
    </div>
  );
}
