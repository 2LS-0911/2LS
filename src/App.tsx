import React, { useState, useEffect, useRef } from "react";
import {
  Wrench, Send, CheckCircle2, ArrowLeft, Moon, Sun,
  MoreVertical, Sparkles, Loader2, KeyRound, CreditCard, Star,
} from "lucide-react";
import { getModels, getEngines, CHINESE_BRANDS_LIST } from "./data/vehicleData";
import { CAR_BRANDS } from "./data/presets";
import AdminPanel from "./AdminPanel";
import RepDashboard from "./RepDashboard";
import StaffPortal from "./StaffPortal";

const API_URL = "/api";

type Screen = "code" | "form" | "problem" | "chat" | "confirm" | "solved";

interface Message { role: "user" | "assistant"; content: string; }

interface RecommendedWork {
  work: string;
  part: string;
  qty: number;
  price: number;
}

const SYMPTOM_CHIPS = [
  { id: "check_engine",     label: "🔴 Check Engine" },
  { id: "no_power",         label: "⚡ Нет тяги" },
  { id: "rough_idle",       label: "🔄 Плавают обороты" },
  { id: "noise",            label: "💨 Посторонний звук" },
  { id: "overheat",         label: "🔥 Перегрев" },
  { id: "fuel_consumption", label: "⛽ Расход вырос" },
  { id: "no_start",         label: "🚫 Не заводится" },
  { id: "vibration",        label: "🚗 Вибрация" },
  { id: "leak",             label: "💧 Утечка" },
  { id: "smoke",            label: "💨 Дымит" },
  // P1.2 — симптомы-маркеры
  { id: "tacho_drops",      label: "📉 Тахометр падает в 0" },
  { id: "stalls_hot",       label: "🌡️ Глохнет на горячую" },
  { id: "stalls_wet",       label: "🌧️ Глохнет в дождь/после мойки" },
  { id: "can_multiblock",   label: "📡 Несколько блоков по CAN" },
  { id: "battery_lamp",     label: "🔋 Лампа АКБ горит" },
];

const TOOL_CHIPS = [
  "Сканер OBD2", "Мотортестер", "Осциллограф",
  "Мультиметр", "Компрессометр", "Газоанализатор",
  "Манометр топлива", "Дымогенератор",
];

function getRouteFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("panel") === "staff") return { type: "staff" as const };
  // backward compat
  if (p.get("admin") === "1" && p.get("key")) return { type: "admin" as const, key: p.get("key")! };
  if (p.get("rep_token")) return { type: "rep" as const, token: p.get("rep_token")! };
  return null;
}

export default function App() {
  const route = getRouteFromURL();
  if (route?.type === "staff") return <StaffPortal />;
  if (route?.type === "admin") return <AdminPanel adminKey={route.key} />;
  if (route?.type === "rep") return <RepDashboard repToken={route.token} />;
  return <DiagApp />;
}

function DiagApp() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [screen, setScreen] = useState<Screen>("code");

  // Service
  const [serviceCode, setServiceCode] = useState(() => localStorage.getItem("2ls_service_code") || "");
  const [serviceCodeInput, setServiceCodeInput] = useState("");
  const [serviceName, setServiceName] = useState(() => localStorage.getItem("2ls_service_name") || "");
  const [credits, setCredits] = useState<number | null>(null);
  const [codeError, setCodeError] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);

  // Screen 1 — Vehicle
  const [brandCategory, setBrandCategory] = useState<"regular" | "chinese">("regular");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("2020");
  const [engine, setEngine] = useState("");
  const [vin, setVin] = useState(""); // Add VIN state

  // Screen 2 — Problem
  const [dtcCode, setDtcCode] = useState("");
  const [noDtc, setNoDtc] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [symptomText, setSymptomText] = useState("");

  // Screen 3 — Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [noAnswer, setNoAnswer] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Screen 4 — Confirm
  const [aiRating, setAiRating] = useState(0);
  const [rootCause, setRootCause] = useState("");
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [refValue, setRefValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiConclusion, setAiConclusion] = useState("");
  const [recommendedWorks, setRecommendedWorks] = useState<RecommendedWork[]>([]);

  // P3 — пакет документов
  const [clientExplanation, setClientExplanation] = useState("");
  const [repairMemo, setRepairMemo] = useState("");


  // Client report fields
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientCar, setClientCar] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [odometer, setOdometer] = useState(""); // Add odometer state

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); if (tg.colorScheme === "dark") setTheme("dark"); }
  }, []);

  useEffect(() => {
    if (serviceCode) { fetchCredits(serviceCode); setScreen("form"); }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── Service code ──────────────────────────────────────────────────
  async function fetchCredits(code: string) {
    try {
      const r = await fetch(`${API_URL}/service/credits?code=${encodeURIComponent(code)}`);
      if (r.ok) {
        const d = await r.json();
        setCredits(d.credits);
        setServiceName(d.service_name || "");
        localStorage.setItem("2ls_service_name", d.service_name || "");
      }
    } catch { /* silent */ }
  }

  async function submitServiceCode() {
    const code = serviceCodeInput.trim();
    if (!code) return;
    setCodeLoading(true); setCodeError("");
    try {
      const r = await fetch(`${API_URL}/service/credits?code=${encodeURIComponent(code)}`);
      if (!r.ok) throw new Error((await r.json()).detail || "Неверный код");
      const d = await r.json();
      setServiceCode(code); setServiceName(d.service_name || ""); setCredits(d.credits);
      localStorage.setItem("2ls_service_code", code);
      localStorage.setItem("2ls_service_name", d.service_name || "");
      setScreen("form");
    } catch (e: unknown) { setCodeError(e instanceof Error ? e.message : String(e)); }
    finally { setCodeLoading(false); }
  }

  // ── Screen 1 → 2 ─────────────────────────────────────────────────
  function goToProblem() {
    if (!brand) { alert("Выберите марку автомобиля"); return; }
    setScreen("problem");
  }

  // ── Screen 2 → 3 ─────────────────────────────────────────────────
  async function startChat() {
    // Deduct credit and create session
    let newSessionId: string | null = null;
    if (serviceCode) {
      try {
        const r = await fetch(`${API_URL}/session/start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service_code: serviceCode }),
        });
        if (!r.ok) {
          const d = await r.json();
          alert(d.detail || "Ошибка запуска сессии");
          if (r.status === 402) setCredits(0);
          return;
        }
        const d = await r.json();
        setCredits(d.credits_remaining);
        newSessionId = d.session_id || null;
        setSessionId(newSessionId);
      } catch { /* allow offline */ }
    }

    // Build context summary (shown as first user "message" to AI)
    const dtcPart = dtcCode ? dtcCode.toUpperCase() : "";
    const symptomLabels = symptoms.map(s => SYMPTOM_CHIPS.find(c => c.id === s)?.label || s);

    let contextMsg = `Автомобиль: ${brand} ${model} ${year}г., двигатель ${engine || "не указан"}.`;
    if (odometer) contextMsg += ` Пробег: ${odometer} км.`; // Add odometer to context message
    if (dtcPart) contextMsg += ` Код ошибки: ${dtcPart}.`;
    else contextMsg += ` Кодов ошибок нет.`;
    if (symptomLabels.length > 0) contextMsg += ` Симптомы: ${symptomLabels.join(", ")}.`;
    if (symptomText.trim()) contextMsg += ` ${symptomText.trim()}`;

    const initMessages: Message[] = [{ role: "user", content: contextMsg }];
    setMessages(initMessages);
    setNoAnswer(false);
    setLoading(true);
    setCurrentPage(0);
    setScreen("chat");

    // Immediately get AI first response
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle: { brand, model, year, engine, odometer, vin }, // Add odometer and vin to vehicle object
          messages: [],
          message: contextMsg,
          service_code: serviceCode || null,
          session_id: newSessionId,
          dtc_codes: dtcPart ? [dtcPart] : [],
          symptoms: symptomLabels,
          symptom_text: symptomText,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = stripCaseSummary(data.reply || "Ошибка ответа сервера.");
      if (reply.includes("недостаточно данных") || reply.includes("Свяжитесь с администрацией")) setNoAnswer(true);
      setMessages([{ role: "user", content: contextMsg }, { role: "assistant", content: reply }]);
    } catch {
      setMessages([{ role: "user", content: contextMsg }, { role: "assistant", content: "Ошибка соединения. Проверьте интернет и попробуйте снова." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function toggleSymptom(id: string) {
    setSymptoms(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }

  // ── Chat ──────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const updated: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(updated);
    setLoading(true);

    try {
      const history = updated.slice(1, -1);
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle: { brand, model, year, engine, odometer, vin }, // Add odometer and vin to vehicle object
          messages: history,
          message: userMsg,
          service_code: serviceCode || null,
          session_id: sessionId,
          dtc_codes: dtcCode ? [dtcCode.toUpperCase()] : [],
          symptoms: symptoms.map(s => SYMPTOM_CHIPS.find(c => c.id === s)?.label || s),
          symptom_text: symptomText,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = stripCaseSummary(data.reply || "Ошибка ответа сервера.");

      // Detect "no answer" response
      const isNoAnswer = reply.includes("недостаточно данных") || reply.includes("Свяжитесь с администрацией");
      if (isNoAnswer) setNoAnswer(true);

      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Ошибка соединения. Проверьте интернет и попробуйте снова." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  // ── Screen 3 → 4 ─────────────────────────────────────────────────
  function goToConfirm() {
    setAiRating(0); setRootCause(""); setToolsUsed([]); setRefValue("");
    setClientName(""); setClientPhone(""); setClientCar(`${brand} ${model} ${year}`); setLaborHours("");
    setReportNote(rootCause); // Pre-fill reportNote with rootCause if available
    setScreen("confirm");
  }

  const addWork = () => {
    setRecommendedWorks(prev => [...prev, { work: "", part: "", qty: 0, price: 0 }]);
  };

  const removeWork = (index: number) => {
    setRecommendedWorks(prev => prev.filter((_, i) => i !== index));
  };

  const handleWorkChange = (index: number, field: keyof RecommendedWork, value: string | number) => {
    setRecommendedWorks(prev => prev.map((rw, i) => i === index ? { ...rw, [field]: value } : rw));
  };

  const totalWorksPrice = recommendedWorks.reduce((sum, rw) => sum + (rw.qty || 0) * (rw.price || 0), 0);

  // ── Screen 4 → 5 ─────────────────────────────────────────────────
  async function saveCase() {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/solve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle: { brand, model, year, engine, odometer, vin }, // Added odometer and vin to vehicle object
          messages,
          service_code: serviceCode || null,
          session_id: sessionId,
          dtc_codes: dtcCode ? [dtcCode.toUpperCase()] : [],
          symptoms: symptoms.map(s => SYMPTOM_CHIPS.find(c => c.id === s)?.label || s),
          symptom_text: symptomText,
          root_cause: rootCause,
          ai_rating: aiRating,
          tools_used: toolsUsed,
          ref_value: refValue,
          no_answer: noAnswer,
          client: clientName ? { name: clientName, phone: clientPhone, car: clientCar, labor_hours: laborHours, note: reportNote } : null,
          recommended_works: recommendedWorks.filter(rw => rw.work || rw.part), // Only send non-empty work items
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json(); // Get JSON response

      // Populate reportNote from case_doc
      const fetchedCaseDoc = data.case_doc;
      if (fetchedCaseDoc) {
        const solution = fetchedCaseDoc.case_summary?.solution || fetchedCaseDoc.root_cause;
        if (solution) {
          setReportNote(solution);
        }

        // Generate AI Conclusion (P0.2)
        try {
          const conclusionRes = await fetch(`${API_URL}/generate_ai_conclusion`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              case_summary: fetchedCaseDoc.case_summary,
              root_cause: fetchedCaseDoc.root_cause,
              symptoms: fetchedCaseDoc.symptoms,
              dtc_codes: fetchedCaseDoc.dtc_codes,
              symptom_text: fetchedCaseDoc.symptom_text,
              vehicle: fetchedCaseDoc.vehicle,
              messages: fetchedCaseDoc.messages,
            }),
          });
          if (!conclusionRes.ok) throw new Error(`HTTP ${conclusionRes.status}`);
          const conclusionData = await conclusionRes.json();
          setAiConclusion(conclusionData.conclusion);
        } catch (conclusionError) {
          console.error("Error generating AI conclusion:", conclusionError);
          setAiConclusion("Не удалось сгенерировать заключение AI.");
        }

        // P3 — пакет документов: объяснение клиенту + памятка
        try {
          const cs = fetchedCaseDoc.case_summary || {};
          const packRes = await fetch(`${API_URL}/generate_case_pack`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              vehicle: fetchedCaseDoc.vehicle,
              root_cause: fetchedCaseDoc.root_cause || cs.root_cause || "",
              solution: cs.solution || "",
              parts_replaced: cs.parts_replaced || [],
              symptoms: fetchedCaseDoc.symptoms || [],
              dtc_codes: fetchedCaseDoc.dtc_codes || [],
              checks_done: cs.checks_done || [],
              symptom_text: fetchedCaseDoc.symptom_text || "",
            }),
          });
          if (packRes.ok) {
            const packData = await packRes.json();
            setClientExplanation(packData.client_explanation || "");
            setRepairMemo(packData.repair_memo || "");
          }
        } catch (packErr) {
          console.error("Case pack generation error:", packErr);
        }
      }

    } catch (e) {
      console.error("Error saving case:", e);
      // Optional: show user an error message
    }
    setScreen("solved");
    setSaving(false);
  }

  function generatePDF() {
    const date = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

    // Generate Act Number: 2LS-YYYYMMDD-HHMMSS-RANDOM
    const now = new Date();
    const yearStr = now.getFullYear().toString();
    const monthStr = (now.getMonth() + 1).toString().padStart(2, '0');
    const dayStr = now.getDate().toString().padStart(2, '0');
    const hourStr = now.getHours().toString().padStart(2, '0');
    const minuteStr = now.getMinutes().toString().padStart(2, '0');
    const secondStr = now.getSeconds().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const actNumber = `2LS-${yearStr}${monthStr}${dayStr}-${hourStr}${minuteStr}${secondStr}-${random}`;

    // Helper to strip emojis for print version
    const stripEmojis = (str: string) => str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');

    const symptomList = symptoms.map(s => SYMPTOM_CHIPS.find(c => c.id === s)?.label || s).join(", ");
    const finalAiConclusion = aiConclusion || ([...messages].reverse().find(m => m.role === "assistant")?.content || "");

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<title>Акт диагностики — ${clientCar || `${brand} ${model} ${year}`}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; padding: 40px 48px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 3px solid #0088cc; margin-bottom: 28px; }
  .logo { font-size: 32px; font-weight: 900; color: #0088cc; letter-spacing: -1px; }
  .logo span { color: #1a1a2e; }
  .doc-meta { text-align: right; }
  .doc-meta .doc-title { font-size: 16px; font-weight: 700; color: #1a1a2e; }
  .doc-meta .doc-num { font-size: 11px; color: #666; margin-top: 3px; }
  .section { margin-bottom: 22px; }
  .section-title { font-size: 10px; font-weight: 700; color: #0088cc; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #e8f4fd; }
  .row { display: flex; gap: 8px; margin-bottom: 6px; }
  .label { font-size: 11px; color: #888; width: 130px; flex-shrink: 0; padding-top: 1px; }
  .value { font-size: 13px; font-weight: 600; color: #1a1a2e; flex: 1; }
  .dtc-badge { display: inline-block; background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 2px 10px; border-radius: 4px; font-family: monospace; font-size: 13px; font-weight: 700; }
  .diagnosis-box { background: #f0f9ff; border-left: 4px solid #0088cc; border-radius: 0 8px 8px 0; padding: 14px 16px; margin-top: 6px; font-size: 12px; line-height: 1.7; color: #1a1a2e; white-space: pre-wrap; max-height: 200px; overflow: hidden; }
  .result-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 14px 16px; }
  .result-box .cause { font-size: 15px; font-weight: 700; color: #166534; }
  .result-box .action { font-size: 12px; color: #166534; margin-top: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
  .info-box .ib-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .info-box .ib-value { font-size: 14px; font-weight: 700; color: #1a1a2e; }
  .sign-section { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sign-block { }
  .sign-line { border-bottom: 1px solid #333; margin-bottom: 6px; height: 32px; }
  .sign-label { font-size: 10px; color: #888; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
  .footer-brand { font-size: 11px; color: #888; }
  .footer-brand strong { color: #0088cc; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .chip { background: #e0f2fe; color: #0369a1; border-radius: 20px; padding: 2px 10px; font-size: 11px; font-weight: 600; }
  @media print {
    body { padding: 24px 32px; }
    @page { margin: 0; size: A4; }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="logo">2<span>LS</span></div>
    <div style="font-size:11px;color:#888;margin-top:2px;">Интеллектуальная диагностика</div>
  </div>
  <div class="doc-meta">
    <div class="doc-title">АКТ ДИАГНОСТИКИ №${actNumber}</div>
    <div class="doc-num">Дата: ${date} ${time}</div>
    ${serviceName ? `<div class="doc-num">Сервис: ${serviceName}</div>` : ""}
  </div>
</div>

<div class="section">
  <div class="section-title">Данные клиента</div>
  <div class="grid2">
    <div class="info-box">
      <div class="ib-label">Клиент</div>
      <div class="ib-value">${clientName || "—"}</div>
    </div>
    <div class="info-box">
      <div class="ib-label">Телефон</div>
      <div class="ib-value">${clientPhone || "—"}</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Автомобиль</div>
  <div class="row"><span class="label">Марка / Модель</span><span class="value">${clientCar || `${brand} ${model}`}</span></div>
  <div class="row"><span class="label">Год выпуска</span><span class="value">${year}</span></div>
  ${vin ? `<div class="row"><span class="label">VIN</span><span class="value">${vin}</span></div>` : ""}
  <div class="row"><span class="label">Двигатель</span><span class="value">${engine || "—"}</span></div>
  ${odometer ? `<div class="row"><span class="label">Пробег</span><span class="value">${odometer} км</span></div>` : ""}
</div>

<div class="section">
  <div class="section-title">Жалоба</div>
  ${dtcCode ? `<div class="row"><span class="label">Код ошибки</span><span class="value"><span class="dtc-badge">${dtcCode}</span></span></div>` : ""}
  ${symptomList ? `<div class="row"><span class="label">Симптомы</span><div class="chips">${symptoms.map(s => `<span class="chip">${stripEmojis(SYMPTOM_CHIPS.find(c => c.id === s)?.label || s)}</span>`).join("")}</div></div>` : ""}
  ${symptomText ? `<div class="row"><span class="label">Описание</span><span class="value">${symptomText}</span></div>` : ""}
</div>

<div class="section">
  <div class="section-title">Результат диагностики</div>
  <div class="result-box">
    <div class="cause">${rootCause}</div>
    ${reportNote ? `<div class="action">Рекомендация: ${reportNote}</div>` : ""}
  </div>
</div>

${finalAiConclusion ? `<div class="section">
  <div class="section-title">Заключение AI-диагноста</div>
  <div class="diagnosis-box">${finalAiConclusion.replace(/\*([^*]+)\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>")}</div>
</div>` : ""}

<div class="grid2" style="margin-bottom:22px;">
  ${laborHours ? `<div class="info-box"><div class="ib-label">Трудоёмкость</div><div class="ib-value">${laborHours} н/ч</div></div>` : ""}
  ${toolsUsed.length > 0 ? `<div class="info-box"><div class="ib-label">Использованы</div><div class="ib-value" style="font-size:12px;">${toolsUsed.join(", ")}</div></div>` : ""}
</div>

${recommendedWorks.length > 0 ? `<div class="section">
  <div class="section-title">Рекомендуемые работы и запчасти</div>
  <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
    <thead>
      <tr style="background-color:#f8fafc;">
        <th style="text-align:left; padding: 8px; border: 1px solid #e2e8f0; font-size:10px; text-transform:uppercase; color:#888;">Работа</th>
        <th style="text-align:left; padding: 8px; border: 1px solid #e2e8f0; font-size:10px; text-transform:uppercase; color:#888;">Запчасть (арт.)</th>
        <th style="text-align:center; padding: 8px; border: 1px solid #e2e8f0; font-size:10px; text-transform:uppercase; color:#888;">Кол-во</th>
        <th style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:10px; text-transform:uppercase; color:#888;">Цена</th>
        <th style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:10px; text-transform:uppercase; color:#888;">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${recommendedWorks.map(rw => `
        <tr>
          <td style="text-align:left; padding: 8px; border: 1px solid #e2e8f0; font-size:12px;">${rw.work || "—"}</td>
          <td style="text-align:left; padding: 8px; border: 1px solid #e2e8f0; font-size:12px;">${rw.part || "—"}</td>
          <td style="text-align:center; padding: 8px; border: 1px solid #e2e8f0; font-size:12px;">${rw.qty || "—"}</td>
          <td style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:12px;">${rw.price ? rw.price.toLocaleString() : "—"}</td>
          <td style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:12px;">${rw.qty && rw.price ? (rw.qty * rw.price).toLocaleString() : "—"}</td>
        </tr>
      `).join("")}
    </tbody>
    <tfoot>
      ${totalWorksPrice > 0 ? `
      <tr>
        <td colspan="4" style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:12px; font-weight:bold;">Итого, предварительно:</td>
        <td style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:14px; font-weight:bold; color:#0088cc;">${totalWorksPrice.toLocaleString()} ₽</td>
      </tr>
      ` : ''}
    </tfoot>
  </table>
</div>` : ''}

<div class="sign-section">
  <div class="sign-block">
    <div class="sign-line"></div>
    <div class="sign-label">Подпись механика / мастера</div>
  </div>
  <div class="sign-block">
    <div class="sign-line"></div>
    <div class="sign-label">Подпись клиента (согласование работ)</div>
  </div>
</div>

<div class="footer">
  <div class="footer-brand">Диагностика выполнена с помощью <strong>2LS</strong> — AI-диагностика для автосервисов</div>
  <div style="font-size:11px;color:#888;">${date}</div>
</div>

<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (w) { w.document.write(html); w.document.close(); }
  }

  // Убирает служебный маркер [CASE_SUMMARY]...[/CASE_SUMMARY] из текста
  function stripCaseSummary(text: string): string {
    return text.replace(/\[CASE_SUMMARY\][\s\S]*?\[\/CASE_SUMMARY\]/g, "").trim();
  }

  function resetApp() {
    setScreen("form");
    setMessages([]); setInput(""); setSessionId(null);
    setBrandCategory("regular"); setBrand(""); setModel(""); setYear("2020"); setEngine("");
    setDtcCode(""); setNoDtc(false); setSymptoms([]); setSymptomText("");
    setNoAnswer(false);
    setOdometer(""); setVin(""); setRecommendedWorks([]); setAiConclusion("");
    setClientExplanation(""); setRepairMemo("");
    setCurrentPage(0);
    if (serviceCode) fetchCredits(serviceCode);
  }

  // ── Chat pagination ───────────────────────────────────────────────
  type ChatPage = { userMsg?: Message; aiMsg?: Message };

  function buildPages(msgs: Message[]): ChatPage[] {
    // msgs[0] is hidden context summary; skip it
    const visible = msgs.slice(1);
    const pages: ChatPage[] = [];
    let i = 0;
    while (i < visible.length) {
      const msg = visible[i];
      if (msg.role === "assistant") {
        // First AI response (no preceding user message on this page)
        pages.push({ aiMsg: msg });
        i++;
      } else if (msg.role === "user") {
        const next = visible[i + 1];
        pages.push({
          userMsg: msg,
          aiMsg: next?.role === "assistant" ? next : undefined,
        });
        i += next?.role === "assistant" ? 2 : 1;
      } else {
        i++;
      }
    }
    // If loading, add a pending page for the last user message that has no AI reply yet
    return pages;
  }

  const chatPages = buildPages(messages);

  // Auto-advance to last page when messages update
  useEffect(() => {
    if (chatPages.length > 0) setCurrentPage(chatPages.length - 1);
  }, [messages.length]);

  // ── Render helpers ────────────────────────────────────────────────
  const isDark = theme === "dark";

  const fieldCls = `h-11 px-3 rounded-xl text-xs font-bold border outline-none transition-colors w-full ${
    isDark ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-blue-500"
           : "bg-[#f5f9fc] border-sky-100/90 text-slate-800 focus:border-blue-500 focus:bg-white"}`;

  const renderContent = (text: string) =>
    text.split("\n").map((line, i) => {
      if (!line) return <span key={i} className="block h-1" />;
      const parts = line.split(/(\*[^*]+\*)/g);
      return (
        <p key={i} className="leading-relaxed">
          {parts.map((p, j) => p.startsWith("*") && p.endsWith("*")
            ? <strong key={j}>{p.slice(1, -1)}</strong> : p)}
        </p>
      );
    });

  const headerSubtitle = {
    code: "Введите код сервиса",
    form: serviceName || "Идентификация авто",
    problem: "Описание проблемы",
    chat: `${brand} ${model}${year ? ` · ${year}` : ""}`,
    confirm: "Подтверждение кейса",
    solved: "Кейс сохранён",
  }[screen];

  const canGoBack = screen === "problem" || screen === "form";

  const problemReady = (dtcCode.trim() || noDtc) && (symptoms.length > 0 || symptomText.trim());

  // ── UI ────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-100" : "bg-[#f0f4f8] text-slate-900"}`}>
      <div className="flex justify-center p-4">
        <div
          className={`relative w-full max-w-[430px] rounded-[48px] border-[10px] shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${
            isDark ? "border-slate-800 bg-slate-950 ring-8 ring-slate-900/30 shadow-black/80"
                   : "border-slate-300 bg-white ring-8 ring-slate-100/85 shadow-sky-900/10"}`}
          style={{ height: "87vh", maxHeight: "840px" }}
        >
          {/* Notch */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-6 rounded-full z-40 flex items-center justify-center pointer-events-none bg-slate-950">
            <div className="w-12 h-1 bg-slate-800 rounded-full" />
            <div className="w-2.5 h-2.5 bg-slate-900 rounded-full ml-auto mr-4" />
          </div>

          {/* Status bar */}
          <div className={`h-10 flex justify-between items-center px-6 pt-3 text-[11px] font-semibold font-mono z-30 ${isDark ? "bg-slate-900 text-slate-300" : "bg-[#0088cc] text-sky-100/90"}`}>
            <span>17:42</span>
            <div className="flex items-center gap-1.5"><span className="text-[10px]">5G</span><span>84%</span></div>
          </div>

          {/* Header */}
          <div className={`h-12 border-b flex items-center justify-between px-4 z-30 ${isDark ? "bg-slate-900 border-slate-800/80 text-slate-200" : "bg-[#0088cc] border-blue-600/10 text-white"}`}>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { if (screen === "problem") setScreen("form"); else if (screen === "form") {} }}
                disabled={!canGoBack}
                className={`p-1.5 rounded-full transition-colors ${canGoBack ? (isDark ? "hover:bg-slate-800" : "hover:bg-white/10") : "opacity-30 cursor-default"}`}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col">
                <span className="text-xs font-bold leading-none tracking-tight">2LS</span>
                <span className={`text-[9px] font-medium ${isDark ? "text-emerald-400" : "text-sky-200"}`}>{headerSubtitle}</span>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {credits !== null && screen !== "code" && (
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${credits > 0 ? (isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-white/20 text-white") : "bg-red-500/30 text-red-300"}`}>
                  <CreditCard className="w-2.5 h-2.5" />{credits}
                </div>
              )}
              <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
                className={`p-1 rounded-md border flex items-center justify-center transition-colors ${isDark ? "bg-slate-800 border-slate-700/50 text-amber-400" : "bg-white/10 border-white/20 text-yellow-300"}`}>
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <MoreVertical className="w-4 h-4 cursor-pointer opacity-60" />
            </div>
          </div>

          {/* Content */}
          <div className={`flex-1 overflow-hidden flex flex-col ${isDark ? "bg-slate-950" : "bg-[#f0f6fc]"}`}>

            {/* ══ SCREEN: CODE ══ */}
            {screen === "code" && (
              <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4">
                <div className="text-center py-4">
                  <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isDark ? "bg-blue-500/10 border border-blue-500/20" : "bg-blue-50 border border-blue-100"}`}>
                    <KeyRound className={`w-8 h-8 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
                  </div>
                  <h2 className={`text-base font-extrabold mb-1 ${isDark ? "text-white" : "text-slate-800"}`}>Код вашего сервиса</h2>
                  <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    Введите код, выданный вашему автосервису администратором 2LS
                  </p>
                </div>
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <input type="text" placeholder="svc_xxxxxxxx" value={serviceCodeInput}
                    onChange={e => setServiceCodeInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && submitServiceCode()}
                    className={`${fieldCls} font-mono text-sm`} />
                  {codeError && <p className="mt-2 text-xs text-red-400">{codeError}</p>}
                </div>
                <button onClick={submitServiceCode} disabled={codeLoading || !serviceCodeInput.trim()}
                  className="w-full py-4 font-extrabold text-[15px] rounded-2xl flex items-center justify-center gap-2.5 h-14 uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40">
                  {codeLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                  Войти
                </button>
              </div>
            )}

            {/* ══ SCREEN: FORM (vehicle) ══ */}
            {screen === "form" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-8">
                <div className="text-center py-2">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-blue-50 text-blue-600 border border-blue-100"}`}>
                    <Wrench className="w-3.5 h-3.5" /> Шаг 1 из 3 — Автомобиль
                  </div>
                </div>

                {credits !== null && (
                  <div className={`flex items-center justify-between px-4 py-2.5 rounded-2xl border text-xs ${credits > 0 ? (isDark ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-emerald-50 border-emerald-100 text-emerald-700") : "bg-red-500/5 border-red-500/20 text-red-400"}`}>
                    <div className="flex items-center gap-2"><CreditCard className="w-3.5 h-3.5" /><span className="font-semibold">{serviceName || serviceCode}</span></div>
                    <span className="font-bold">{credits > 0 ? `${credits} кредитов` : "Кредиты закончились"}</span>
                  </div>
                )}

                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                    <Wrench className={`w-3.5 h-3.5 ${isDark ? "text-emerald-500" : "text-blue-500"}`} /> Спецификация
                  </h2>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Марка *</label>
                      <div className={`flex rounded-xl border overflow-hidden text-xs font-semibold mb-0.5 ${isDark ? "border-slate-700" : "border-slate-200"}`}>
                        <button
                          type="button"
                          onClick={() => { setBrandCategory("regular"); setBrand(""); setModel(""); setEngine(""); }}
                          className={`flex-1 py-2 transition-colors ${brandCategory === "regular" ? (isDark ? "bg-emerald-600 text-white" : "bg-blue-600 text-white") : (isDark ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500")}`}
                        >Обычные</button>
                        <button
                          type="button"
                          onClick={() => { setBrandCategory("chinese"); setBrand(""); setModel(""); setEngine(""); }}
                          className={`flex-1 py-2 transition-colors ${brandCategory === "chinese" ? "bg-red-500 text-white" : (isDark ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500")}`}
                        >🇨🇳 Китайские</button>
                      </div>
                      <select value={brand} onChange={e => { setBrand(e.target.value); setModel(""); setEngine(""); }} className={fieldCls}>
                        <option value="">Выберите марку...</option>
                        {(brandCategory === "chinese" ? CHINESE_BRANDS_LIST : CAR_BRANDS).map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Модель</label>
                      {getModels(brand).length > 0
                        ? <select value={model} onChange={e => { setModel(e.target.value); setEngine(""); }} className={fieldCls}>
                            <option value="">Выберите модель...</option>
                            {getModels(brand).map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        : <input type="text" placeholder="Введите модель" value={model} onChange={e => setModel(e.target.value)} className={fieldCls} />}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Год</label>
                        <input type="number" min="1990" max="2030" placeholder="2020" value={year} onChange={e => setYear(e.target.value)} className={fieldCls} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Двигатель</label>
                        {getEngines(brand, model).length > 0
                          ? <select value={engine} onChange={e => setEngine(e.target.value)} className={fieldCls}>
                              <option value="">Выбрать...</option>
                              {getEngines(brand, model).map(eng => <option key={eng} value={eng}>{eng}</option>)}
                            </select>
                          : <input type="text" placeholder="1ZZ-FE 1.8" value={engine} onChange={e => setEngine(e.target.value)} className={fieldCls} />}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Пробег</label>
                      <input type="number" placeholder="200000" value={odometer} onChange={e => setOdometer(e.target.value)} className={fieldCls} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">VIN</label>
                      <input type="text" placeholder="WBA................" value={vin} onChange={e => setVin(e.target.value.toUpperCase())} className={fieldCls} />
                    </div>
                  </div>
                </div>

                <button onClick={goToProblem} disabled={!brand || credits === 0}
                  className={`w-full py-4 font-extrabold text-[15px] rounded-2xl flex items-center justify-center gap-2.5 h-14 uppercase tracking-wider transition-all ${!brand || credits === 0 ? "bg-slate-400 text-slate-200 cursor-not-allowed opacity-60" : isDark ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950" : "bg-blue-600 hover:bg-blue-700 text-white"}`}>
                  Далее → Описание проблемы
                </button>

                <button onClick={() => { setServiceCode(""); localStorage.removeItem("2ls_service_code"); localStorage.removeItem("2ls_service_name"); setScreen("code"); setCredits(null); }}
                  className="text-center text-[10px] text-slate-400 hover:text-slate-300 transition-colors">
                  Изменить код сервиса
                </button>
              </div>
            )}

            {/* ══ SCREEN: PROBLEM ══ */}
            {screen === "problem" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-8">
                <div className="text-center py-2">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold ${isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-100"}`}>
                    <Sparkles className="w-3.5 h-3.5" /> Шаг 2 из 3 — Проблема
                  </div>
                </div>

                {/* Vehicle summary */}
                <div className={`px-4 py-2.5 rounded-2xl border text-xs flex items-center gap-2 ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-sky-100 shadow-sm"}`}>
                  <Wrench className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>
                    <strong className={isDark ? "text-slate-200" : "text-slate-700"}>{brand} {model}</strong>
                    {year ? ` · ${year}г.` : ""}{engine ? ` · ${engine}` : ""}
                  </span>
                </div>

                {/* DTC input */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 block">Код ошибки (DTC)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="P0420"
                      value={dtcCode}
                      onChange={e => { setDtcCode(e.target.value.toUpperCase()); if (e.target.value) setNoDtc(false); }}
                      disabled={noDtc}
                      className={`${fieldCls} font-mono flex-1 ${noDtc ? "opacity-40" : ""}`}
                    />
                    <button
                      onClick={() => { setNoDtc(v => !v); if (!noDtc) setDtcCode(""); }}
                      className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${noDtc ? (isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-slate-200 border-slate-300 text-slate-700") : (isDark ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-500")}`}
                    >
                      Нет кода
                    </button>
                  </div>
                  {noDtc && <p className="text-[10px] text-amber-500 mt-1.5">⚠️ Без кода диагностика сложнее — описание симптомов особенно важно</p>}
                </div>

                {/* Symptoms chips */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 block">Симптомы <span className="text-[10px] font-normal normal-case">(выберите все подходящие)</span></label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {SYMPTOM_CHIPS.map(chip => (
                      <button key={chip.id} onClick={() => toggleSymptom(chip.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                          symptoms.includes(chip.id)
                            ? isDark ? "bg-blue-600 border-blue-500 text-white" : "bg-blue-600 border-blue-600 text-white"
                            : isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
                        }`}>
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Дополнительное описание (необязательно)..."
                    value={symptomText}
                    onChange={e => setSymptomText(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none resize-none ${isDark ? "bg-slate-800 border-slate-700 text-slate-200 placeholder-slate-500" : "bg-[#f5f9fc] border-sky-100 text-slate-800 placeholder-slate-400"}`}
                  />
                </div>

                <button onClick={startChat} disabled={!problemReady}
                  className={`w-full py-4 font-extrabold text-[15px] rounded-2xl flex items-center justify-center gap-2.5 h-14 uppercase tracking-wider transition-all ${
                    problemReady
                      ? isDark ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950" : "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-slate-400 text-slate-200 cursor-not-allowed opacity-60"}`}>
                  <Sparkles className="w-5 h-5" /> Начать диагностику
                </button>
                <p className={`text-center text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Укажите DTC-код или выберите хотя бы один симптом
                </p>
              </div>
            )}

            {/* ══ SCREEN: CHAT ══ */}
            {screen === "chat" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                {/* Sub-header */}
                <div className={`px-4 py-2 border-b flex items-center justify-between shrink-0 ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white/80 border-sky-100 shadow-sm"}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    {dtcCode && <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-50 text-amber-700"}`}>{dtcCode}</span>}
                    {symptoms.slice(0, 2).map(s => (
                      <span key={s} className={`text-[10px] px-2 py-0.5 rounded ${isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
                        {SYMPTOM_CHIPS.find(c => c.id === s)?.label}
                      </span>
                    ))}
                    {symptoms.length > 2 && <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>+{symptoms.length - 2}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {credits !== null && <span className={`text-[10px] font-bold ${credits > 0 ? "text-emerald-400" : "text-red-400"}`}>{credits} кр.</span>}
                    <button onClick={goToConfirm}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Решено
                    </button>
                  </div>
                </div>

                {/* Pagination nav */}
                {chatPages.length > 1 && (
                  <div className={`px-4 py-2 flex items-center justify-between border-b shrink-0 ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white/80 border-sky-100"}`}>
                    <button
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${currentPage === 0 ? "opacity-30 cursor-default" : isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >← Назад</button>
                    <span className={`text-[10px] font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {currentPage + 1} / {chatPages.length}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(chatPages.length - 1, p + 1))}
                      disabled={currentPage === chatPages.length - 1}
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${currentPage === chatPages.length - 1 ? "opacity-30 cursor-default" : isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >Вперёд →</button>
                  </div>
                )}

                {/* Messages — current page */}
                <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
                  {chatPages.length === 0 && !loading && null}

                  {chatPages.length > 0 && (() => {
                    const page = chatPages[currentPage];
                    return (
                      <>
                        {page?.userMsg && (
                          <div className="flex justify-end">
                            <div className="max-w-[88%] px-3 py-2.5 rounded-2xl rounded-tr-sm text-[12px] bg-blue-600 text-white">
                              {renderContent(page.userMsg.content)}
                            </div>
                          </div>
                        )}
                        {page?.aiMsg && (
                          <div className="flex justify-start">
                            <div className={`max-w-[88%] px-3 py-2.5 rounded-2xl rounded-tl-sm text-[12px] ${isDark ? "bg-slate-800 text-slate-200" : "bg-white border border-sky-100 text-slate-800 shadow-sm"}`}>
                              {renderContent(page.aiMsg.content)}
                            </div>
                          </div>
                        )}
                        {/* Loading on last page when AI hasn't responded yet */}
                        {loading && currentPage === chatPages.length - 1 && !page?.aiMsg && (
                          <div className="flex justify-start">
                            <div className={`px-4 py-3 rounded-2xl rounded-tl-sm text-xs flex items-center gap-2 ${isDark ? "bg-slate-800 text-slate-400" : "bg-white border border-sky-100 text-slate-500 shadow-sm"}`}>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Анализирую...
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Loading on empty state (very first response) */}
                  {loading && chatPages.length === 0 && (
                    <div className="flex justify-start">
                      <div className={`px-4 py-3 rounded-2xl rounded-tl-sm text-xs flex items-center gap-2 ${isDark ? "bg-slate-800 text-slate-400" : "bg-white border border-sky-100 text-slate-500 shadow-sm"}`}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Анализирую...
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className={`px-3 py-3 border-t flex gap-2 items-end shrink-0 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-sky-100"}`}>
                  <textarea ref={inputRef} rows={1} value={input}
                    onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
                    placeholder="Напишите ответ и нажмите →"
                    className={`flex-1 px-3 py-2.5 rounded-xl text-xs border outline-none resize-none transition-colors min-h-[40px] max-h-[100px] leading-relaxed ${isDark ? "bg-slate-800 border-slate-700 text-slate-200 focus:border-blue-500 placeholder-slate-500" : "bg-[#f5f9fc] border-sky-100/90 text-slate-800 focus:border-blue-500 placeholder-slate-400"}`}
                  />
                  <button onClick={sendMessage} disabled={!input.trim() || loading}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 ${input.trim() && !loading ? "bg-blue-600 hover:bg-blue-700 text-white" : isDark ? "bg-slate-800 text-slate-600" : "bg-slate-200 text-slate-400"}`}>
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ══ SCREEN: CONFIRM ══ */}
            {screen === "confirm" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-8">
                <div className="text-center py-2">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Подтверждение кейса
                  </div>
                </div>

                {/* Pre-filled block */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-3 tracking-wider">Данные кейса (заполнено автоматически)</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] text-slate-400 w-20 shrink-0 pt-0.5">Автомобиль</span>
                      <span className={`text-xs font-bold ${isDark ? "text-slate-200" : "text-slate-700"}`}>{brand} {model} {year}г. · {engine || "—"}</span>
                    </div>
                    {dtcCode && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-slate-400 w-20 shrink-0 pt-0.5">DTC-код</span>
                        <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-50 text-amber-700"}`}>{dtcCode}</span>
                      </div>
                    )}
                    {symptoms.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-slate-400 w-20 shrink-0 pt-0.5">Симптомы</span>
                        <div className="flex flex-wrap gap-1">
                          {symptoms.map(s => (
                            <span key={s} className={`text-[10px] px-2 py-0.5 rounded-full ${isDark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                              {SYMPTOM_CHIPS.find(c => c.id === s)?.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {symptomText && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-slate-400 w-20 shrink-0 pt-0.5">Описание</span>
                        <span className={`text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}>{symptomText}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Rating */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-3 tracking-wider">Оцените ответ AI</p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => setAiRating(n)}
                        className={`text-2xl transition-transform ${n <= aiRating ? "scale-110" : "opacity-30"}`}>
                        <Star className={`w-8 h-8 ${n <= aiRating ? "fill-amber-400 text-amber-400" : isDark ? "text-slate-600" : "text-slate-300"}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Root cause — required */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-2 tracking-wider">Что оказалось причиной? *</p>
                  <input type="text" placeholder="Например: отравленный катализатор"
                    value={rootCause} onChange={e => setRootCause(e.target.value)}
                    className={fieldCls} />
                </div>

                {/* Optional — bonus credit */}
                <div className={`p-4 rounded-3xl border-2 border-dashed ${isDark ? "border-amber-500/30 bg-amber-500/5" : "border-amber-200 bg-amber-50/50"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">💡</span>
                    <p className={`text-xs font-bold ${isDark ? "text-amber-400" : "text-amber-700"}`}>+1 кредит за полный кейс</p>
                  </div>

                  <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wider">Инструменты которые использовали</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {TOOL_CHIPS.map(tool => (
                      <button key={tool} onClick={() => setToolsUsed(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool])}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                          toolsUsed.includes(tool)
                            ? "bg-amber-500 border-amber-500 text-white"
                            : isDark ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-500"
                        }`}>
                        {tool}
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wider">Ключевое измеренное значение</p>
                  <input type="text" placeholder="Например: λ после катализатора копирует сигнал до"
                    value={refValue} onChange={e => setRefValue(e.target.value)}
                    className={`${fieldCls} text-[11px]`} />
                </div>

                {/* Client report block */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">📄</span>
                    <p className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Отчёт для клиента <span className={`font-normal text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>(необязательно)</span></p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Имя клиента</label>
                        <input type="text" placeholder="Иван Петров"
                          value={clientName} onChange={e => setClientName(e.target.value)}
                          className={fieldCls} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Телефон</label>
                        <input type="tel" placeholder="+7 900 000-00-00"
                          value={clientPhone} onChange={e => setClientPhone(e.target.value)}
                          className={fieldCls} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Автомобиль клиента</label>
                      <input type="text" placeholder={`${brand} ${model} ${year}`}
                        value={clientCar} onChange={e => setClientCar(e.target.value)}
                        className={fieldCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Нормачасы</label>
                        <input type="text" placeholder="2 н/ч"
                          value={laborHours} onChange={e => setLaborHours(e.target.value)}
                          className={fieldCls} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Рекомендация</label>
                        <input type="text" placeholder="Замена катализатора"
                          value={reportNote} onChange={e => setReportNote(e.target.value)}
                          className={fieldCls} />
                      </div>
                    </div>
                  </div>
                  {clientName && (
                    <p className={`mt-2 text-[10px] ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                      📎 PDF-отчёт будет сформирован после сохранения
                    </p>
                  )}
                </div>

                {/* Recommended Works block (P0.4) */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-sky-100 shadow-sm"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">🛠️</span>
                    <p className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                      Рекомендуемые работы и запчасти <span className={`font-normal text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>(необязательно)</span>
                    </p>
                  </div>
                  {recommendedWorks.map((rw, i) => (
                    <div key={i} className="flex flex-col gap-2 border-b border-dashed mb-3 pb-3 last:border-b-0 last:pb-0">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Работа</label>
                        <input type="text" placeholder="Замена свечей зажигания"
                          value={rw.work} onChange={e => handleWorkChange(i, "work", e.target.value)}
                          className={fieldCls} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Запчасть (артикул)</label>
                        <input type="text" placeholder="NGK BKR6E-11"
                          value={rw.part} onChange={e => handleWorkChange(i, "part", e.target.value)}
                          className={fieldCls} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Кол-во</label>
                          <input type="number" placeholder="4"
                            value={rw.qty || ""} onChange={e => handleWorkChange(i, "qty", parseFloat(e.target.value))}
                            className={fieldCls} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Цена за ед.</label>
                          <input type="number" placeholder="500"
                            value={rw.price || ""} onChange={e => handleWorkChange(i, "price", parseFloat(e.target.value))}
                            className={fieldCls} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Сумма</label>
                          <input type="text" readOnly
                            value={rw.qty && rw.price ? (rw.qty * rw.price).toLocaleString() : ""}
                            className={`${fieldCls} opacity-70`} />
                        </div>
                      </div>
                      <button onClick={() => removeWork(i)}
                        className={`text-red-400 text-[10px] uppercase font-semibold tracking-wider self-end mt-1 ${isDark ? "hover:text-red-300" : "hover:text-red-500"}`}>
                        Удалить работу
                      </button>
                    </div>
                  ))}
                  <button onClick={addWork}
                    className={`w-full py-2 mt-2 rounded-xl text-xs font-bold border transition-colors ${isDark ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
                    + Добавить работу
                  </button>
                  {totalWorksPrice > 0 && (
                    <div className={`mt-4 pt-3 border-t ${isDark ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold uppercase tracking-wider">Итого, предварительно:</span>
                        <span className="text-lg font-extrabold text-blue-500">{totalWorksPrice.toLocaleString()} ₽</span>
                      </div>
                    </div>
                  )}
                </div>

                <button onClick={saveCase} disabled={saving || !rootCause.trim()}
                  className={`w-full py-4 font-extrabold text-[15px] rounded-2xl flex items-center justify-center gap-2.5 h-14 uppercase tracking-wider transition-all ${
                    rootCause.trim() && !saving
                      ? isDark ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950" : "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-slate-400 text-slate-200 cursor-not-allowed opacity-60"}`}>
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Сохранить кейс
                </button>
                <p className={`text-center text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>* Укажите причину чтобы сохранить</p>
              </div>
            )}

            {/* ══ SCREEN: SOLVED ══ */}
            {screen === "solved" && (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isDark ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-emerald-50 border border-emerald-200"}`}>
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                </div>
                <div>
                  <h2 className={`text-lg font-extrabold mb-2 ${isDark ? "text-white" : "text-slate-900"}`}>
                    {noAnswer ? "Кейс передан администратору" : "Кейс сохранён!"}
                  </h2>
                  <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    {noAnswer
                      ? "По этому случаю недостаточно данных. Администратор разберёт его индивидуально и вернёт средства за запрос."
                      : "Кейс автоматически обработан и ожидает проверки менеджером. После одобрения он пополнит базу знаний 2LS."}
                  </p>
                </div>
                {(toolsUsed.length > 0 || refValue) && (
                  <div className={`w-full p-3 rounded-2xl border text-xs text-left ${isDark ? "bg-amber-500/5 border-amber-500/20 text-amber-400" : "bg-amber-50 border-amber-100 text-amber-700"}`}>
                    <p className="font-bold">+1 кредит начислен за полный кейс</p>
                  </div>
                )}
                {clientName && rootCause && (
                  <button onClick={generatePDF}
                    className={`w-full py-4 rounded-2xl font-extrabold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${isDark ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white shadow-md"}`}>
                    <span>📄</span> Скачать акт PDF
                  </button>
                )}

                {/* P3 — Объяснение для клиента */}
                {clientExplanation && (
                  <div className={`w-full p-4 rounded-2xl border text-left ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-blue-50 border-blue-100"}`}>
                    <p className={`text-[10px] uppercase font-bold tracking-wider mb-2 ${isDark ? "text-blue-400" : "text-blue-600"}`}>💬 Объяснение для клиента</p>
                    <p className={`text-xs leading-relaxed ${isDark ? "text-slate-300" : "text-slate-700"}`}>{clientExplanation}</p>
                    <button
                      onClick={() => { navigator.clipboard?.writeText(clientExplanation); }}
                      className={`mt-2 text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
                    >📋 Скопировать (для WhatsApp/Telegram)</button>
                  </div>
                )}

                {/* P3 — Памятка после ремонта */}
                {repairMemo && (
                  <div className={`w-full p-4 rounded-2xl border text-left ${isDark ? "bg-amber-500/5 border-amber-500/20" : "bg-amber-50 border-amber-100"}`}>
                    <p className={`text-[10px] uppercase font-bold tracking-wider mb-2 ${isDark ? "text-amber-400" : "text-amber-700"}`}>📋 Памятка после ремонта</p>
                    <p className={`text-xs leading-relaxed whitespace-pre-line ${isDark ? "text-slate-300" : "text-slate-700"}`}>{repairMemo}</p>
                  </div>
                )}

                <button onClick={resetApp}
                  className={`w-full py-4 rounded-2xl font-extrabold text-sm uppercase tracking-wider transition-all ${isDark ? "bg-slate-900 border border-slate-800 text-slate-200 hover:bg-slate-800" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Новая диагностика
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
