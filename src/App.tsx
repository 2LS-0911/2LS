import React, { useState, useEffect, useRef } from "react";
import {
  Wrench, Send, CheckCircle2, ArrowLeft, Moon, Sun,
  MoreVertical, Sparkles, Loader2, KeyRound, CreditCard, Star,
} from "lucide-react";
import logoImg from "./Logo.webp";
import { getModels, getEngines, CHINESE_BRANDS_LIST, VEHICLE_DATA } from "./data/vehicleData";
import AdminPanel from "./AdminPanel";
import RepDashboard from "./RepDashboard";
import StaffPortal from "./StaffPortal";

const API_URL = "/api";

type Screen = "code" | "menu" | "form" | "problem" | "chat" | "confirm" | "solved" | "torque_form" | "torque_result" | "ask";

interface Message { role: "user" | "assistant"; content: string; }

interface TorqueData {
  torque_nm: { min: number; max: number };
  angle_degrees?: number;
  stages?: Array<{ step: string; value: string }>;
  tightening_order_desc?: string;
  bolt_class?: string;
  reusable?: boolean | null;
  pattern: "circle" | "rectangle_grid" | "linear_row" | "single";
  pattern_data?: { rows?: number; cols?: number; points?: number; sequence?: number[] };
  source: "cache" | "olp" | "ai";
  confidence: "high" | "medium";
  note?: string;
}

const TORQUE_NODES = [
  { id: "cylinder_head",       label: "ГБЦ — головка блока цилиндров" },
  { id: "wheel_bolts",         label: "Колёсные болты / гайки" },
  { id: "brake_caliper_front", label: "Тормозной суппорт передний" },
  { id: "brake_caliper_rear",  label: "Тормозной суппорт задний" },
  { id: "oil_pan",             label: "Поддон картера" },
  { id: "intake_manifold",     label: "Коллектор впускной" },
  { id: "exhaust_manifold",    label: "Коллектор выпускной" },
  { id: "spark_plug",          label: "Свечи зажигания" },
  { id: "drain_plug",          label: "Сливная пробка масла" },
  { id: "crankshaft_pulley",   label: "Шкив / болт коленвала" },
  { id: "wheel_hub_nut",       label: "Гайка ступицы" },
  { id: "suspension_arm",      label: "Рычаги подвески" },
  { id: "strut_top_mount",     label: "Опора стойки (верхняя)" },
  { id: "ball_joint",          label: "Шаровая опора" },
  { id: "tie_rod_end",         label: "Наконечник рулевой тяги" },
  { id: "steering_rack",       label: "Рулевая рейка (крепление)" },
  { id: "timing_cover",        label: "Крышка ГРМ" },
  { id: "subframe",            label: "Подрамник" },
];

// Паттерн схемы — по типу узла, не нужен OLP
const NODE_SCHEME: Record<string, { pattern: "circle" | "rectangle_grid" | "linear_row" | "single"; rows?: number; cols?: number; points?: number }> = {
  cylinder_head:       { pattern: "rectangle_grid", rows: 2, cols: 5 },
  wheel_bolts:         { pattern: "circle",         points: 5 },
  brake_caliper_front: { pattern: "linear_row",     points: 2 },
  brake_caliper_rear:  { pattern: "linear_row",     points: 2 },
  oil_pan:             { pattern: "rectangle_grid", rows: 2, cols: 6 },
  intake_manifold:     { pattern: "linear_row",     points: 4 },
  exhaust_manifold:    { pattern: "linear_row",     points: 4 },
  spark_plug:          { pattern: "single" },
  drain_plug:          { pattern: "single" },
  crankshaft_pulley:   { pattern: "single" },
  wheel_hub_nut:       { pattern: "single" },
  suspension_arm:      { pattern: "linear_row",     points: 2 },
  strut_top_mount:     { pattern: "circle",         points: 3 },
  ball_joint:          { pattern: "single" },
  tie_rod_end:         { pattern: "single" },
  steering_rack:       { pattern: "linear_row",     points: 3 },
  timing_cover:        { pattern: "rectangle_grid", rows: 2, cols: 4 },
  subframe:            { pattern: "rectangle_grid", rows: 2, cols: 3 },
};

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
  { id: "spark_black_track", label: "⚡ Чёрная дорожка на свече" },
  { id: "stall_coasting",   label: "⬇️ Глохнет при сбросе газа" },
];

const TOOL_CHIPS = [
  "Сканер OBD2", "Мотортестер", "Осциллограф",
  "Мультиметр", "Компрессометр", "Газоанализатор",
  "Манометр топлива", "Дымогенератор",
];

const DTC_SUGGESTIONS: { code: string; desc: string }[] = [
  { code: "P0300", desc: "Случайные пропуски воспламенения" },
  { code: "P0301", desc: "Пропуск воспламенения, цилиндр 1" },
  { code: "P0302", desc: "Пропуск воспламенения, цилиндр 2" },
  { code: "P0303", desc: "Пропуск воспламенения, цилиндр 3" },
  { code: "P0304", desc: "Пропуск воспламенения, цилиндр 4" },
  { code: "P0171", desc: "Бедная смесь, банк 1" },
  { code: "P0172", desc: "Богатая смесь, банк 1" },
  { code: "P0420", desc: "Эффективность катализатора ниже нормы, банк 1" },
  { code: "P0335", desc: "Цепь датчика положения коленвала (ДПКВ)" },
  { code: "P0340", desc: "Цепь датчика положения распредвала (ДПРВ)" },
  { code: "P0130", desc: "Датчик O2, банк 1, датчик 1 — сигнал" },
  { code: "P0136", desc: "Датчик O2, банк 1, датчик 2 — сигнал" },
  { code: "P0102", desc: "ДМРВ — низкий сигнал" },
  { code: "P0103", desc: "ДМРВ — высокий сигнал" },
  { code: "P0113", desc: "Датчик температуры воздуха (ДТВ) — высокий сигнал" },
  { code: "P0116", desc: "Датчик температуры охлаждающей жидкости (ДТОЖ) — диапазон" },
  { code: "P0400", desc: "Система рециркуляции отработавших газов (EGR)" },
  { code: "P0440", desc: "Система контроля испарений топлива (EVAP)" },
  { code: "P0500", desc: "Датчик скорости автомобиля" },
  { code: "P0601", desc: "Внутренняя ошибка ЭБУ — контрольная сумма" },
  { code: "U0100", desc: "Нет связи с ЭБУ двигателя" },
  { code: "U0155", desc: "Нет связи с панелью приборов" },
  { code: "B1000", desc: "Ошибка блока управления SRS (подушки безопасности)" },
  { code: "C0035", desc: "Датчик скорости переднего левого колеса (ABS)" },
];

const DTC_REGEX = /^[PpBbCcUu]\d{4}$/;

function getRouteFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("panel") === "staff") return { type: "staff" as const };
  // backward compat
  if (p.get("admin") === "1" && p.get("key")) return { type: "admin" as const, key: p.get("key")! };
  if (p.get("rep_token")) return { type: "rep" as const, token: p.get("rep_token")! };
  return null;
}

const PERSIST_KEY = "2ls_diag_state";

export default function App() {
  const route = getRouteFromURL();
  if (route?.type === "staff") return <StaffPortal />;
  if (route?.type === "admin") return <AdminPanel adminKey={route.key} />;
  if (route?.type === "rep") return <RepDashboard repToken={route.token} />;
  return <DiagApp />;
}

function DiagApp() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
  const [desktopForced, setDesktopForced] = useState(false);
  const [screen, setScreen] = useState<Screen>("code");

  // Hidden staff entry — 5 clicks on the "Вход для персонала" link
  const [showStaffPortal, setShowStaffPortal] = useState(false);
  const [staffClicks, setStaffClicks] = useState(0);
  const staffClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleStaffLinkClick() {
    if (staffClickTimer.current) clearTimeout(staffClickTimer.current);
    const next = staffClicks + 1;
    if (next >= 5) { setShowStaffPortal(true); setStaffClicks(0); return; }
    setStaffClicks(next);
    staffClickTimer.current = setTimeout(() => setStaffClicks(0), 1500);
  }

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
  const [dtcCodes, setDtcCodes] = useState<string[]>([]);
  const [dtcInput, setDtcInput] = useState("");
  const [dtcError, setDtcError] = useState("");
  const [dtcDropdown, setDtcDropdown] = useState(false);
  const [noDtc, setNoDtc] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [symptomText, setSymptomText] = useState("");

  // Torque module
  const [torqueNode, setTorqueNode] = useState("");
  const [torqueLoading, setTorqueLoading] = useState(false);
  const [torqueResult, setTorqueResult] = useState<TorqueData | null>(null);
  const [torqueError, setTorqueError] = useState("");

  // «Любой вопрос» — поисковый ассистент (Sonar Pro)
  const [askId, setAskId] = useState<string | null>(null);
  const [askMessages, setAskMessages] = useState<Message[]>([]);
  const [askInput, setAskInput] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState("");
  const [askLimitReached, setAskLimitReached] = useState(false);

  // Screen 3 — Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [noAnswer, setNoAnswer] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [chatError, setChatError] = useState<{ message: string; payload: Record<string, unknown>; retryCount: number } | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [chatImage, setChatImage] = useState<{ base64: string; mime: string; name: string } | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [laborRate, setLaborRate] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [odometer, setOdometer] = useState("");

  useEffect(() => {
    const handleResize = () => { if (!desktopForced) setIsDesktop(window.innerWidth >= 768); };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [desktopForced]);

  useEffect(() => {
    if (desktopForced && window.innerWidth >= 768) setIsDesktop(true);
  }, [desktopForced]);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.colorScheme === "dark") setTheme("dark");
      tg.setHeaderColor?.("#7ec8f0");
      const desktopPlatforms = ["tdesktop", "macos", "web", "weba", "webk"];
      if (desktopPlatforms.includes(tg.platform)) setDesktopForced(true);
      // Обновляем высоту при изменении viewport (клавиатура, ориентация)
      const applyViewport = () => {
        if (tg.viewportHeight) {
          document.documentElement.style.setProperty("--tg-viewport-height", `${tg.viewportHeight}px`);
        }
      };
      tg.onEvent?.("viewportChanged", applyViewport);
      applyViewport();
    }

    // Load persisted state — URL ?state= param takes priority (cross-browser share from Telegram)
    function applyState(state: Record<string, unknown>, hasCode: boolean) {
      if (state.screen && (state.screen === "code" || hasCode)) setScreen(state.screen as Screen);
      if (state.brandCategory) setBrandCategory(state.brandCategory as "regular" | "chinese");
      if (state.brand) setBrand(state.brand as string);
      if (state.model) setModel(state.model as string);
      if (state.year) setYear(state.year as string);
      if (state.engine) setEngine(state.engine as string);
      if (state.vin) setVin(state.vin as string);
      if (state.odometer) setOdometer(state.odometer as string);
      if (state.dtcCodes) setDtcCodes(state.dtcCodes as string[]);
      else if (state.dtcCode) setDtcCodes([state.dtcCode as string]); // backward compat
      if (state.noDtc !== undefined) setNoDtc(state.noDtc as boolean);
      if (state.symptoms) setSymptoms(state.symptoms as string[]);
      if (state.symptomText) setSymptomText(state.symptomText as string);
      if (state.messages) setMessages(state.messages as Message[]);
      if (state.sessionId) setSessionId(state.sessionId as string);
      if (state.noAnswer !== undefined) setNoAnswer(state.noAnswer as boolean);
      if (state.rootCause) setRootCause(state.rootCause as string);
      if (state.aiRating) setAiRating(state.aiRating as number);
      if (state.toolsUsed) setToolsUsed(state.toolsUsed as string[]);
      if (state.refValue) setRefValue(state.refValue as string);
      if (state.clientName) setClientName(state.clientName as string);
      if (state.clientPhone) setClientPhone(state.clientPhone as string);
      if (state.clientCar) setClientCar(state.clientCar as string);
      if (state.laborHours) setLaborHours(state.laborHours as string);
      if (state.laborRate) setLaborRate(state.laborRate as string);
      if (state.reportNote) setReportNote(state.reportNote as string);
      if (state.recommendedWorks) setRecommendedWorks(state.recommendedWorks as RecommendedWork[]);
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlStateRaw = urlParams.get("state");
      if (urlStateRaw) {
        const state = JSON.parse(decodeURIComponent(escape(atob(urlStateRaw))));
        // Restore service code to localStorage so fetchCredits works
        if (state.serviceCode) {
          localStorage.setItem("2ls_service_code", state.serviceCode);
          setServiceCode(state.serviceCode);
        }
        if (state.serviceName) {
          localStorage.setItem("2ls_service_name", state.serviceName);
          setServiceName(state.serviceName);
        }
        applyState(state, !!state.serviceCode);
        // Clean URL so Telegram hash and state param don't pollute the address bar
        window.history.replaceState({}, "", window.location.origin + window.location.pathname);
      } else {
        const saved = localStorage.getItem(PERSIST_KEY);
        if (saved) {
          const state = JSON.parse(saved);
          const hasCode = !!localStorage.getItem("2ls_service_code");
          applyState(state, hasCode);
        }
      }
    } catch (e) { console.error("Failed to load state", e); }
  }, []);

  // Persist state on changes
  useEffect(() => {
    if (screen === "code") return; // Don't persist on login screen
    const state = {
      screen, brandCategory, brand, model, year, engine, vin, odometer,
      dtcCodes, noDtc, symptoms, symptomText,
      messages, sessionId, noAnswer,
      rootCause, aiRating, toolsUsed, refValue,
      clientName, clientPhone, clientCar, laborHours, laborRate, reportNote,
      recommendedWorks
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
  }, [
    screen, brandCategory, brand, model, year, engine, vin, odometer,
    dtcCodes, noDtc, symptoms, symptomText,
    messages, sessionId, noAnswer,
    rootCause, aiRating, toolsUsed, refValue,
    clientName, clientPhone, clientCar, laborHours, laborRate, reportNote,
    recommendedWorks
  ]);

  useEffect(() => {
    if (serviceCode) { 
      fetchCredits(serviceCode); 
      setScreen(prev => {
        // If we already loaded a screen from PERSIST_KEY (e.g. 'chat'), keep it
        if (prev !== "code") return prev;
        return "menu";
      });
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── Chat helpers ──────────────────────────────────────────────────
  const RETRY_DELAYS = [3000, 6000, 12000];

  async function _fetchChat(payload: Record<string, unknown>): Promise<{ reply: string; fallback_model?: boolean }> {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.status >= 400 && res.status < 500) {
        const d = await res.json().catch(() => ({}));
        const err = new Error(d.detail || d.message || `HTTP ${res.status}`) as Error & { noRetry: boolean };
        err.noRetry = true;
        throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(tid);
    }
  }

  async function _sendWithRetry(
    payload: Record<string, unknown>,
    attempt = 0
  ): Promise<{ reply: string; fallback_model?: boolean }> {
    try {
      return await _fetchChat(payload);
    } catch (err: unknown) {
      const isNoRetry = (err as { noRetry?: boolean }).noRetry;
      const isAbort = (err as { name?: string }).name === "AbortError";
      if (isNoRetry || attempt >= RETRY_DELAYS.length) throw err;
      // AbortError = таймаут 30с — тоже ретрай
      if (!isAbort && !(err instanceof Error)) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      return _sendWithRetry(payload, attempt + 1);
    }
  }

  function _saveChatSession(msgs: Message[]) {
    try {
      sessionStorage.setItem("2ls_session", JSON.stringify({
        session_id: sessionId,
        messages: msgs,
        vehicle: { brand, model, year, engine },
        dtc_codes: dtcCodes,
        symptoms,
      }));
    } catch { /* quota exceeded — ignore */ }
  }

  function resetToStart() {
    sessionStorage.removeItem("2ls_session");
    setMessages([]); setInput(""); setLoading(false);
    setChatError(null); setFallbackUsed(false); setNoAnswer(false);
    setChatImage(null);
    setScreen("code");
  }

  async function handleImageSelect(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      alert("Файл слишком большой. Максимум 10 МБ.");
      return;
    }
    setImageProcessing(true);
    try {
      const base64 = await _resizeImage(file);
      setChatImage({ base64, mime: "image/jpeg", name: file.name });
      setNoDtc(false);
    } finally {
      setImageProcessing(false);
    }
  }

  function _resizeImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const r = Math.min(MAX / width, MAX / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

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
      if (!r.ok) {
        let msg = "Неверный код";
        try { const err = await r.json(); msg = err.detail || msg; } catch {}
        throw new Error(msg);
      }
      const d = await r.json();
      setServiceCode(code); setServiceName(d.service_name || ""); setCredits(d.credits);
      localStorage.setItem("2ls_service_code", code);
      localStorage.setItem("2ls_service_name", d.service_name || "");
      setScreen("menu");
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
    const dtcPart = dtcCodes.length > 0 ? dtcCodes.join(", ") : "";
    const symptomLabels = symptoms.map(s => SYMPTOM_CHIPS.find(c => c.id === s)?.label || s);

    let contextMsg = `Автомобиль: ${brand} ${model} ${year}г., двигатель ${engine || "не указан"}.`;
    if (odometer) contextMsg += ` Пробег: ${odometer} км.`;
    if (dtcPart) contextMsg += ` ${dtcCodes.length > 1 ? "Коды ошибок" : "Код ошибки"}: ${dtcPart}.`;
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
    const initPayload: Record<string, unknown> = {
      vehicle: { brand, model, year, engine, odometer, vin },
      messages: [],
      message: contextMsg,
      service_code: serviceCode || null,
      session_id: newSessionId,
      dtc_codes: dtcCodes,
      symptoms: symptomLabels,
      symptom_text: symptomText,
    };
    setChatError(null);
    setFallbackUsed(false);
    try {
      const data = await _sendWithRetry(initPayload);
      const reply = stripCaseSummary(data.reply || "Ошибка ответа сервера.");
      if (reply.includes("недостаточно данных") || reply.includes("Свяжитесь с администрацией")) setNoAnswer(true);
      if (data.fallback_model) setFallbackUsed(true);
      const finalMsgs: Message[] = [{ role: "user", content: contextMsg }, { role: "assistant", content: reply }];
      setMessages(finalMsgs);
      _saveChatSession(finalMsgs);
    } catch {
      setChatError({ message: "Не удалось получить ответ. Проверьте интернет.", payload: initPayload, retryCount: 3 });
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
    setChatError(null);

    const payload: Record<string, unknown> = {
      vehicle: { brand, model, year, engine, odometer, vin },
      messages: updated.slice(1, -1),
      message: userMsg,
      service_code: serviceCode || null,
      session_id: sessionId,
      dtc_codes: dtcCodes,
      symptoms: symptoms.map(s => SYMPTOM_CHIPS.find(c => c.id === s)?.label || s),
      symptom_text: symptomText,
      image_base64: chatImage?.base64 || null,
      image_mime: chatImage?.mime || null,
    };
    setChatImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      const data = await _sendWithRetry(payload);
      const reply = stripCaseSummary(data.reply || "Ошибка ответа сервера.");
      if (reply.includes("недостаточно данных") || reply.includes("Свяжитесь с администрацией")) setNoAnswer(true);
      if (data.fallback_model) setFallbackUsed(true);
      const finalMsgs: Message[] = [...updated, { role: "assistant", content: reply }];
      setMessages(finalMsgs);
      _saveChatSession(finalMsgs);
    } catch {
      setChatError({ message: "Не удалось отправить. Проверьте интернет.", payload, retryCount: 3 });
      // Rollback optimistic user message so user can retry
      setMessages(messages);
      setInput(userMsg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  // ── Screen 3 → 4 ─────────────────────────────────────────────────
  function goToConfirm() {
    setAiRating(0); setRootCause(""); setToolsUsed([]); setRefValue("");
    setClientName(""); setClientPhone(""); setClientCar(`${brand} ${model}`);
    setLaborHours(""); // keep laborRate — mechanic likely reuses same rate
    setReportNote("");
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
          dtc_codes: dtcCodes,
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
        // Only fill recommendation from case_summary.solution if mechanic left it empty.
        // Never use root_cause as recommendation fallback — they are different fields.
        const solution = fetchedCaseDoc.case_summary?.solution;
        if (solution && !reportNote.trim()) {
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
          setAiConclusion("Не удалось сгенерировать заключение.");
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
    }
    // Refresh credit balance — charge happens at solve, not at session start
    if (serviceCode) fetchCredits(serviceCode);
    setScreen("solved");
    setSaving(false);
  }

  function generatePDF() {
    const date = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

    const parsedLaborHours = parseFloat(laborHours) || 0;
    const parsedLaborRate = parseFloat(laborRate) || 0;
    const laborCost = parsedLaborHours > 0 && parsedLaborRate > 0 ? parsedLaborHours * parsedLaborRate : 0;

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
    // Use only LLM-generated formal conclusion; never fall back to raw chat messages in official documents.
    const finalAiConclusion = aiConclusion || "";

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
  ${dtcCodes.length > 0 ? `<div class="row"><span class="label">${dtcCodes.length > 1 ? "Коды ошибок" : "Код ошибки"}</span><span class="value">${dtcCodes.map(c => `<span class="dtc-badge">${c}</span>`).join(" ")}</span></div>` : ""}
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
  <div class="section-title">Заключение диагноста</div>
  <div class="diagnosis-box">${finalAiConclusion.replace(/\*([^*]+)\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>")}</div>
</div>` : ""}

<div class="grid2" style="margin-bottom:22px;">
  <div class="info-box">
    <div class="ib-label">Трудоёмкость</div>
    <div class="ib-value">${laborHours ? `${laborHours} н/ч` : "—"}</div>
    ${parsedLaborRate > 0 ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">Ставка: ${parsedLaborRate.toLocaleString("ru-RU")} ₽/н/ч</div>` : ""}
    ${laborCost > 0 ? `<div style="font-size:13px;font-weight:700;color:#0088cc;margin-top:4px;">Стоимость работ: ${laborCost.toLocaleString("ru-RU")} ₽</div>` : ""}
  </div>
  <div class="info-box"><div class="ib-label">Использованы</div><div class="ib-value" style="font-size:12px;">${toolsUsed.length > 0 ? toolsUsed.join(", ") : "—"}</div></div>
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
      ${laborCost > 0 ? `
      <tr style="background:#f0f9ff;">
        <td colspan="3" style="text-align:left; padding: 8px; border: 1px solid #e2e8f0; font-size:12px; font-weight:600; color:#0369a1;">Диагностика / работа: ${parsedLaborHours} н/ч × ${parsedLaborRate.toLocaleString("ru-RU")} ₽</td>
        <td colspan="2" style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:13px; font-weight:700; color:#0088cc;">${laborCost.toLocaleString("ru-RU")} ₽</td>
      </tr>
      ` : ''}
      ${(totalWorksPrice + laborCost) > 0 ? `
      <tr>
        <td colspan="4" style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:12px; font-weight:bold;">Итого, предварительно:</td>
        <td style="text-align:right; padding: 8px; border: 1px solid #e2e8f0; font-size:14px; font-weight:bold; color:#0088cc;">${(totalWorksPrice + laborCost).toLocaleString("ru-RU")} ₽</td>
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
  <div class="footer-brand">Диагностика выполнена с помощью <strong>2LS</strong> — диагностика для автосервисов</div>
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
    localStorage.removeItem(PERSIST_KEY);
    setScreen("menu");
    setMessages([]); setInput(""); setSessionId(null);
    setBrandCategory("regular"); setBrand(""); setModel(""); setYear("2020"); setEngine("");
    setDtcCodes([]); setDtcInput(""); setDtcError(""); setNoDtc(false); setSymptoms([]); setSymptomText("");
    setNoAnswer(false);
    setOdometer(""); setVin(""); setRecommendedWorks([]); setAiConclusion("");
    setLaborRate("");
    setClientExplanation(""); setRepairMemo("");
    setCurrentPage(0);
    if (serviceCode) fetchCredits(serviceCode);
  }

  // ── Torque query ──────────────────────────────────────────────────
  async function handleTorqueQuery() {
    if (!brand || !torqueNode) return;
    setTorqueLoading(true);
    setTorqueError("");
    setTorqueResult(null);
    setScreen("torque_result");
    try {
      const res = await fetch(`${API_URL}/torque`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, model, year, engine, node: torqueNode, service_code: serviceCode || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTorqueResult(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTorqueError(msg.includes("503") || msg.includes("500")
        ? "Ошибка сервера при получении данных. Попробуйте ещё раз."
        : "Не удалось подключиться к серверу. Проверьте что бэкенд запущен.");
    } finally {
      setTorqueLoading(false);
    }
  }

  // ── «Любой вопрос» (Sonar Pro) ────────────────────────────────────
  function startNewAsk() {
    setAskId(null);
    setAskMessages([]);
    setAskInput("");
    setAskError("");
    setAskLimitReached(false);
  }

  async function handleAskSend() {
    const q = askInput.trim();
    if (!q || askLoading) return;
    const isNewDialog = !askId;
    // Новый диалог требует 0.5 кредита
    if (isNewDialog && (credits === null || credits < 0.5)) {
      setAskError("Недостаточно кредитов (нужно 0.5). Свяжитесь с администрацией.");
      return;
    }
    setAskError("");
    setAskLoading(true);
    setAskMessages(prev => [...prev, { role: "user", content: q }]);
    setAskInput("");
    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_code: serviceCode, question: q, ask_id: askId }),
      });
      if (res.status === 402) {
        setAskError("Недостаточно кредитов (нужно 0.5). Свяжитесь с администрацией.");
        setAskMessages(prev => prev.slice(0, -1)); // откатываем вопрос
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.ask_id) setAskId(d.ask_id);
      if (typeof d.credits_remaining === "number") setCredits(d.credits_remaining);
      if (d.limit_reached && !d.answer) {
        // Бюджет исчерпан ещё до ответа — откатываем вопрос
        setAskMessages(prev => prev.slice(0, -1));
        setAskLimitReached(true);
        return;
      }
      if (d.answer) setAskMessages(prev => [...prev, { role: "assistant", content: d.answer }]);
      setAskLimitReached(!!d.limit_reached);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAskError(msg.includes("Failed to fetch")
        ? "Не удалось подключиться к серверу."
        : "Ошибка при получении ответа. Попробуйте ещё раз.");
      setAskMessages(prev => prev.slice(0, -1));
    } finally {
      setAskLoading(false);
    }
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

  const fieldCls = `${isDesktop ? "h-9" : "h-11"} px-3 rounded-xl text-xs font-bold border outline-none transition-colors w-full ${
    isDark ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-sky-400"
           : "bg-white border-[#ddd8ce] text-slate-800 focus:border-[#7ec8f0] focus:bg-white"}`;

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
    menu: serviceName || "Выбор инструмента",
    form: serviceName || "Идентификация авто",
    problem: "Описание проблемы",
    chat: `${brand} ${model}${year ? ` · ${year}` : ""}`,
    confirm: "Подтверждение кейса",
    solved: "Кейс сохранён",
    torque_form: "Моменты затяжки",
    torque_result: TORQUE_NODES.find(n => n.id === torqueNode)?.label || "Результат",
    ask: "Любой вопрос",
  }[screen];

  // Генерирует правильный порядок затяжки крест-накрест когда OLP не даёт sequence
  function defaultGridSequence(rows: number, cols: number): number[] {
    const seq: number[] = [];
    const center = Math.floor(cols / 2);
    // Обходим колонки от центра наружу: center, center+1, center-1, center+2, ...
    const colOrder: number[] = [center];
    for (let d = 1; d < cols; d++) {
      if (center + d < cols) colOrder.push(center + d);
      if (center - d >= 0) colOrder.push(center - d);
    }
    for (const c of colOrder) {
      for (let r = 0; r < rows; r++) {
        seq.push(r * cols + c + 1);
      }
    }
    return seq;
  }

  function defaultCircleSequence(n: number): number[] {
    // Стандартный паттерн "звезда": через одну позицию
    const step = Math.ceil(n / 2);
    const seq: number[] = [];
    const used = new Set<number>();
    let pos = 1;
    while (seq.length < n) {
      if (!used.has(pos)) { seq.push(pos); used.add(pos); }
      const next = ((pos - 1 + step) % n) + 1;
      pos = used.has(next) ? ((pos % n) + 1) : next;
      if (seq.length < n && used.size < n) {
        // перебор если зациклились
        for (let i = 1; i <= n; i++) { if (!used.has(i)) { pos = i; break; } }
      }
    }
    return seq;
  }

  function TorqueSVG({ node, patternData }: { node: string; patternData?: TorqueData["pattern_data"] }) {
    const blue = "#0088cc";
    const arrowColor = "#0088cc";
    const nodeDefault = NODE_SCHEME[node] || { pattern: "single" as const };
    const pattern = nodeDefault.pattern;
    const resolvedRows   = patternData?.rows   || nodeDefault.rows   || 2;
    const resolvedCols   = patternData?.cols   || nodeDefault.cols   || 5;
    const resolvedPoints = patternData?.points || nodeDefault.points || 5;

    // Возвращает позиции болтов в порядке seq[0]→seq[1]→... (для рисования стрелок)
    function makeArrowPaths(positions: {x:number;y:number}[], seq: number[], boltR: number): {x1:number;y1:number;x2:number;y2:number}[] {
      const arrows = [];
      for (let i = 0; i < seq.length - 1; i++) {
        const from = positions[seq[i] - 1];
        const to   = positions[seq[i + 1] - 1];
        if (!from || !to) continue;
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len, ny = dy / len;
        arrows.push({ x1: from.x + nx * (boltR + 2), y1: from.y + ny * (boltR + 2), x2: to.x - nx * (boltR + 5), y2: to.y - ny * (boltR + 5) });
      }
      return arrows;
    }

    function makeBoltLabels(total: number, seq: number[]): number[] {
      const labels = Array(total).fill(0);
      if (seq.length === total) {
        seq.forEach((boltIdx, step) => { labels[boltIdx - 1] = step + 1; });
      } else {
        labels.forEach((_, i) => { labels[i] = i + 1; });
      }
      return labels;
    }

    const arrowMarker = (id: string) => (
      <defs>
        <marker id={id} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" fill={arrowColor} fillOpacity="0.6" />
        </marker>
      </defs>
    );

    if (pattern === "circle") {
      const n = resolvedPoints;
      const rawSeq = patternData?.sequence || [];
      const seq = rawSeq.length === n ? rawSeq : defaultCircleSequence(n);
      const boltLabel = makeBoltLabels(n, seq);
      const cx = 80, cy = 80, orbitR = 58, boltR = 13;
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i * 2 * Math.PI / n) - Math.PI / 2;
        return { x: cx + orbitR * Math.cos(a), y: cy + orbitR * Math.sin(a) };
      });
      const arrows = makeArrowPaths(pts, seq, boltR);
      return (
        <svg viewBox="0 0 160 160" className="w-full mx-auto" style={{ maxHeight: 140 }}>
          {arrowMarker("arr-c")}
          <circle cx={cx} cy={cy} r={18} fill={isDark ? "#334155" : "#f1f5f9"} stroke="#94a3b8" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="1" strokeDasharray="4 3" />
          {arrows.map((a, i) => (
            <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={arrowColor} strokeWidth="1.2" strokeOpacity="0.5" markerEnd="url(#arr-c)" />
          ))}
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={boltR} fill={blue} fillOpacity={0.15} stroke={blue} strokeWidth="1.5" />
              <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="11" fontWeight="bold" fill={blue}>{boltLabel[i]}</text>
            </g>
          ))}
        </svg>
      );
    }

    if (pattern === "rectangle_grid") {
      const rows = resolvedRows;
      const cols = resolvedCols;
      const total = rows * cols;
      const rawSeq = patternData?.sequence || [];
      const seq = rawSeq.length === total ? rawSeq : defaultGridSequence(rows, cols);
      const boltLabel = makeBoltLabels(total, seq);
      const padX = 18, padY = 16, cellW2 = 42, cellH2 = 36, boltR = 12;
      const W = 2 * padX + (cols - 1) * cellW2;
      const H = 2 * padY + (rows - 1) * cellH2;
      const pts = Array.from({ length: total }, (_, idx) => ({
        x: padX + (idx % cols) * cellW2,
        y: padY + Math.floor(idx / cols) * cellH2,
      }));
      const arrows = makeArrowPaths(pts, seq, boltR);
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full mx-auto">
          {arrowMarker("arr-g")}
          {arrows.map((a, i) => (
            <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={arrowColor} strokeWidth="1.2" strokeOpacity="0.5" markerEnd="url(#arr-g)" />
          ))}
          {pts.map((p, idx) => (
            <g key={idx}>
              <circle cx={p.x} cy={p.y} r={boltR} fill={blue} fillOpacity={0.15} stroke={blue} strokeWidth="1.5" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" fontWeight="bold" fill={blue}>{boltLabel[idx]}</text>
            </g>
          ))}
        </svg>
      );
    }

    if (pattern === "linear_row") {
      const n = resolvedPoints;
      const rawSeq = patternData?.sequence || [];
      const seq = rawSeq.length === n ? rawSeq : Array.from({ length: n }, (_, i) => i + 1);
      const boltLabel = makeBoltLabels(n, seq);
      const padX = 16, boltR = 12, spacing = Math.max(36, Math.min(54, (240 - 2 * padX) / Math.max(n - 1, 1)));
      const W = 2 * padX + (n - 1) * spacing;
      const H = 44, cy2 = 22;
      const pts = Array.from({ length: n }, (_, i) => ({ x: n > 1 ? padX + i * spacing : W / 2, y: cy2 }));
      const arrows = makeArrowPaths(pts, seq, boltR);
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full mx-auto">
          {arrowMarker("arr-l")}
          <line x1={padX} y1={cy2} x2={W - padX} y2={cy2} stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="2" />
          {arrows.map((a, i) => (
            <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={arrowColor} strokeWidth="1.2" strokeOpacity="0.5" markerEnd="url(#arr-l)" />
          ))}
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={boltR} fill={blue} fillOpacity={0.15} stroke={blue} strokeWidth="1.5" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" fontWeight="bold" fill={blue}>{boltLabel[i]}</text>
            </g>
          ))}
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 70 70" className="w-16 h-16 mx-auto">
        <circle cx={35} cy={35} r={28} fill={blue} fillOpacity={0.15} stroke={blue} strokeWidth="2" />
        <text x={35} y={40} textAnchor="middle" fontSize="13" fill={blue} fontWeight="bold">1</text>
      </svg>
    );
  }

  const canGoBack = screen === "problem" || screen === "form";

  const problemReady = (dtcCodes.length > 0 || noDtc) && (symptoms.length > 0 || symptomText.trim());

  if (showStaffPortal) return <StaffPortal />;

  // ── UI ────────────────────────────────────────────────────────────
  return (
    <div
      className={`font-sans transition-colors duration-300 flex flex-col overflow-hidden ${isDark ? "bg-slate-950 text-slate-100" : "bg-[#f5f3ee] text-slate-900"}`}
      style={{ height: "var(--tg-viewport-height, 100dvh)" }}
    >
      <div
        className={`flex flex-col overflow-hidden ${isDesktop ? "" : "flex-1 w-full"}`}
        style={isDesktop ? {
          zoom: 1.7,
          width: "calc(100vw / 1.7)",
          height: "calc(var(--tg-viewport-height, 100dvh) / 1.7)",
        } : undefined}
      >
        <div className={`flex-1 flex flex-col overflow-hidden ${isDark ? "bg-slate-950" : "bg-[#f5f3ee]"}`}
        >

          {/* Content */}
          <div className={`flex-1 overflow-hidden flex flex-col ${isDark ? "bg-slate-950" : "bg-[#f5f3ee]"}`}>

            {/* ══ SCREEN: CODE ══ */}
            {screen === "code" && (
              <div className={`flex-1 flex flex-col items-center px-5 pt-2 pb-3 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>

                {/* Логотип — заполняет всё свободное пространство */}
                <div className="flex-1 min-h-0 flex items-center justify-center w-full">
                  <img src={logoImg} alt="2LS" className="w-full object-contain" style={{ mixBlendMode: "multiply", maxHeight: "48vh" }} />
                </div>

                {/* Нижняя секция — прижата к тулбару */}
                <div className="w-full flex flex-col gap-3">
                  {/* Заголовок */}
                  <h1 className={`text-2xl font-black tracking-tight text-center ${isDark ? "text-slate-100" : "text-slate-800"}`}>
                    Диагностика автомобилей
                  </h1>

                  {/* Поле ввода */}
                  <div className={`p-4 rounded-2xl border ${isDark ? "bg-slate-900/60 border-slate-700" : "bg-white border-[#ddd8ce] shadow-md"}`}>
                    <label className={`text-[10px] uppercase font-bold tracking-widest mb-2 block ${isDark ? "text-slate-500" : "text-slate-400"}`}>Код сервиса</label>
                    <input type="text" placeholder="svc_xxxxxxxx" value={serviceCodeInput}
                      onChange={e => setServiceCodeInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && submitServiceCode()}
                      className={`${fieldCls} font-mono text-base tracking-wider`} />
                    {codeError && <p className="mt-2 text-xs text-red-400 font-medium">{codeError}</p>}
                  </div>
                  {/* Секретный вход — 5 кликов подряд */}
                  <p
                    onClick={handleStaffLinkClick}
                    className={`text-center text-[11px] select-none cursor-default ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    Код выдаётся вашему автосервису менеджером 2LS
                  </p>

                  {/* Кнопка */}
                  <button onClick={submitServiceCode} disabled={codeLoading || !serviceCodeInput.trim()}
                    className="w-full h-14 font-extrabold text-[15px] rounded-2xl flex items-center justify-center gap-2.5 uppercase tracking-wider bg-[#7ec8f0] hover:bg-[#5cb8e8] active:scale-[0.98] text-white disabled:opacity-40 shadow-lg shadow-sky-300/40 transition-all">
                    {codeLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                    Войти в сервис
                  </button>
                </div>

              </div>
            )}

            {/* ══ SCREEN: MENU ══ */}
            {screen === "menu" && (
              <div className={`flex-1 flex flex-col items-center px-5 pt-2 pb-4 min-h-0 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
                {credits !== null && (
                  <div className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[11px] mb-2 ${credits > 0 ? (isDark ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-emerald-50 border border-emerald-100 text-emerald-700") : "bg-red-500/5 border border-red-500/20 text-red-400"}`}>
                    <div className="flex items-center gap-1.5"><CreditCard className="w-3 h-3" /><span className="font-semibold truncate max-w-[160px]">{serviceName || serviceCode}</span></div>
                    <span className="font-bold shrink-0">{credits > 0 ? `${credits} кр.` : "Кредиты закончились"}</span>
                  </div>
                )}
                <div className="flex-1 min-h-0 flex items-center justify-center w-full" style={{ maxHeight: "38vh" }}>
                  <img src={logoImg} alt="2LS" className="w-3/4 object-contain h-full" style={{ mixBlendMode: "multiply" }} />
                </div>
                <div className="w-full flex flex-col gap-2.5 shrink-0">
                  <p className={`text-center text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>Выберите инструмент</p>
                  <button onClick={() => setScreen("form")}
                    className={`w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-extrabold text-base uppercase tracking-wider transition-all shadow-sm ${isDark ? "bg-slate-900 border border-slate-700 text-slate-100 hover:border-sky-500" : "bg-white border border-[#ddd8ce] text-slate-800 hover:border-[#7ec8f0] hover:shadow-md"}`}>
                    <Wrench className="w-5 h-5 text-[#7ec8f0] shrink-0" />
                    Диагностика
                  </button>
                  <button onClick={() => setScreen("torque_form")}
                    className={`w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-extrabold text-base uppercase tracking-wider transition-all shadow-sm ${isDark ? "bg-slate-900 border border-slate-700 text-slate-100 hover:border-amber-500" : "bg-white border border-[#ddd8ce] text-slate-800 hover:border-amber-400 hover:shadow-md"}`}>
                    <span className="text-xl shrink-0">📐</span>
                    Моменты затяжки
                  </button>
                  <button onClick={() => { startNewAsk(); setScreen("ask"); }}
                    className={`w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-extrabold text-base uppercase tracking-wider transition-all shadow-sm ${isDark ? "bg-slate-900 border border-slate-700 text-slate-100 hover:border-violet-500" : "bg-white border border-[#ddd8ce] text-slate-800 hover:border-violet-400 hover:shadow-md"}`}>
                    <Sparkles className="w-5 h-5 text-violet-400 shrink-0" />
                    Любой вопрос
                  </button>
                  <button onClick={() => { setServiceCode(""); setServiceCodeInput(""); localStorage.removeItem("2ls_service_code"); localStorage.removeItem("2ls_service_name"); localStorage.removeItem(PERSIST_KEY); setScreen("code"); setCredits(null); }}
                    className={`text-center text-[10px] py-1 ${isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-400 hover:text-slate-500"} transition-colors`}>
                    Изменить код сервиса
                  </button>
                </div>
              </div>
            )}

            {/* ══ SCREEN: FORM (vehicle) ══ */}
            {screen === "form" && (
              <div className={`flex-1 flex flex-col overflow-hidden px-4 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
                <button onClick={() => setScreen("menu")}
                  className={`flex items-center gap-1 text-xs font-semibold self-start px-1 py-0.5 rounded-lg transition-colors ${isDesktop ? "mt-1 mb-0.5" : "mt-2 mb-1"} ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Меню
                </button>
                {/* Скроллируемая область формы */}
                <div className={`flex-1 overflow-y-auto pt-1 pb-2 flex flex-col ${isDesktop ? "gap-1.5" : "gap-2"}`}>
                  {credits !== null && (
                    <div className={`flex items-center justify-between px-3 py-1.5 rounded-xl text-[10px] ${credits > 0 ? (isDark ? "bg-emerald-500/5 border border-emerald-500/20 text-emerald-400" : "bg-emerald-50 border border-emerald-100 text-emerald-700") : "bg-red-500/5 border border-red-500/20 text-red-400"}`}>
                      <div className="flex items-center gap-1.5"><CreditCard className="w-3 h-3" /><span className="font-semibold truncate max-w-[140px]">{serviceName || serviceCode}</span></div>
                      <span className="font-bold shrink-0">{credits > 0 ? `${credits} кр.` : "Кредиты закончились"}</span>
                    </div>
                  )}
                  <div className={`${isDesktop ? "p-2" : "p-3"} rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                    <div className={`flex flex-col ${isDesktop ? "gap-1.5" : "gap-2"}`}>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Марка *</label>
                        <div className={`flex rounded-xl border overflow-hidden text-xs font-semibold mb-0.5 ${isDark ? "border-slate-700" : "border-slate-200"}`}>
                          <button type="button" onClick={() => { setBrandCategory("regular"); setBrand(""); setModel(""); setEngine(""); }}
                            className={`flex-1 py-1.5 transition-colors ${brandCategory === "regular" ? (isDark ? "bg-emerald-600 text-white" : "bg-[#7ec8f0] text-white") : (isDark ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500")}`}>Обычные</button>
                          <button type="button" onClick={() => { setBrandCategory("chinese"); setBrand(""); setModel(""); setEngine(""); }}
                            className={`flex-1 py-1.5 transition-colors ${brandCategory === "chinese" ? "bg-red-500 text-white" : (isDark ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500")}`}>🇨🇳 Китайские</button>
                        </div>
                        <select value={brand} onChange={e => { setBrand(e.target.value); setModel(""); setEngine(""); }} className={fieldCls}>
                          <option value="">Выберите марку...</option>
                          {(brandCategory === "chinese" ? CHINESE_BRANDS_LIST : Object.keys(VEHICLE_DATA)).map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Модель</label>
                        {getModels(brand).length > 0
                          ? <select value={model} onChange={e => { setModel(e.target.value); setEngine(""); }} className={fieldCls}>
                              <option value="">Выберите модель...</option>
                              {getModels(brand).map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          : <input type="text" placeholder="Введите модель" value={model} onChange={e => setModel(e.target.value)} className={fieldCls} />}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Год</label>
                          <input type="number" min="1990" max="2030" placeholder="2020" value={year} onChange={e => setYear(e.target.value)} className={fieldCls} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Двигатель</label>
                          {getEngines(brand, model).length > 0
                            ? <select value={engine} onChange={e => setEngine(e.target.value)} className={fieldCls}>
                                <option value="">Выбрать...</option>
                                {getEngines(brand, model).map(eng => <option key={eng} value={eng}>{eng}</option>)}
                              </select>
                            : <input type="text" placeholder="1ZZ-FE 1.8" value={engine} onChange={e => setEngine(e.target.value)} className={fieldCls} />}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Пробег</label>
                          <input type="number" placeholder="200000" value={odometer} onChange={e => setOdometer(e.target.value)} className={fieldCls} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">VIN</label>
                          <input type="text" placeholder="WBA..." value={vin} onChange={e => setVin(e.target.value.toUpperCase())} className={fieldCls} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Кнопки прижаты к низу */}
                <div className={`${isDesktop ? "pb-3 pt-1" : "pb-6 pt-2"} flex flex-col gap-2`}>
                  <button onClick={goToProblem} disabled={!brand || credits === 0}
                    className={`w-full font-extrabold rounded-2xl flex items-center justify-center gap-2 uppercase tracking-wider transition-all ${isDesktop ? "py-2 h-10 text-xs" : "py-3.5 h-12 text-[14px]"} ${!brand || credits === 0 ? "bg-slate-400 text-slate-200 cursor-not-allowed opacity-60" : isDark ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950" : "bg-[#7ec8f0] hover:bg-[#5cb8e8] text-white"}`}>
                    Далее → Описание проблемы
                  </button>
                </div>
              </div>
            )}

            {/* ══ SCREEN: PROBLEM ══ */}
            {screen === "problem" && (
              <div className={`flex-1 flex flex-col overflow-hidden px-4 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
              {/* Back nav */}
              <button onClick={() => setScreen("form")}
                className={`flex items-center gap-1 text-xs font-semibold self-start px-1 py-0.5 rounded-lg transition-colors ${isDesktop ? "mt-1 mb-0.5" : "mt-2 mb-1"} ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
                <ArrowLeft className="w-3.5 h-3.5" /> Назад
              </button>
              <div className={`flex-1 overflow-y-auto pb-1 flex flex-col ${isDesktop ? "gap-1.5" : "gap-1.5"}`}>

                {/* Vehicle summary */}
                <div className={`px-3 py-1 rounded-xl border text-[11px] flex items-center gap-2 ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                  <Wrench className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>
                    <strong className={isDark ? "text-slate-200" : "text-slate-700"}>{brand} {model}</strong>
                    {year ? ` · ${year}г.` : ""}{engine ? ` · ${engine}` : ""}
                  </span>
                </div>

                {/* DTC — chips input */}
                <div className={`px-2.5 py-1.5 rounded-2xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase text-slate-400">Коды ошибок DTC</span>
                    <button
                      onClick={() => { setNoDtc(v => !v); if (!noDtc) { setDtcCodes([]); setDtcInput(""); setDtcError(""); } }}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors ${noDtc ? (isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-slate-200 border-slate-300 text-slate-700") : (isDark ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-500")}`}
                    >Нет кода</button>
                  </div>

                  {/* Chips */}
                  {dtcCodes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {dtcCodes.map(code => (
                        <span key={code} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                          {code}
                          <button onClick={() => setDtcCodes(prev => prev.filter(c => c !== code))} className="opacity-60 hover:opacity-100 ml-0.5">✕</button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Input + dropdown */}
                  {!noDtc && (
                    <div className="relative">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="P0420 и Enter"
                          value={dtcInput}
                          disabled={noDtc}
                          onChange={e => {
                            const v = e.target.value.toUpperCase();
                            setDtcInput(v);
                            setDtcError("");
                            setDtcDropdown(v.length >= 2);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              const v = dtcInput.trim().toUpperCase();
                              if (!v) return;
                              if (!DTC_REGEX.test(v)) { setDtcError("Формат: P0302, B1234, C0100, U0001"); return; }
                              if (!dtcCodes.includes(v)) setDtcCodes(prev => [...prev, v]);
                              setDtcInput(""); setDtcError(""); setDtcDropdown(false);
                            }
                          }}
                          onBlur={() => setTimeout(() => setDtcDropdown(false), 150)}
                          className={`${fieldCls} font-mono flex-1 h-9`}
                        />
                        <button onClick={() => {
                          const v = dtcInput.trim().toUpperCase();
                          if (!v) return;
                          if (!DTC_REGEX.test(v)) { setDtcError("Формат: P0302, B1234, C0100, U0001"); return; }
                          if (!dtcCodes.includes(v)) setDtcCodes(prev => [...prev, v]);
                          setDtcInput(""); setDtcError(""); setDtcDropdown(false);
                        }} className={`px-3 h-9 rounded-xl text-sm font-bold border transition-colors shrink-0 ${isDark ? "bg-slate-700 border-slate-600 text-white hover:bg-slate-600" : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"}`}>+</button>
                      </div>

                      {/* Dropdown suggestions */}
                      {dtcDropdown && (
                        <div className={`absolute z-20 left-0 right-0 top-full mt-1 rounded-xl border shadow-lg overflow-hidden max-h-40 overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"}`}>
                          {DTC_SUGGESTIONS.filter(s => s.code.startsWith(dtcInput.toUpperCase())).slice(0, 6).map(s => (
                            <button key={s.code} onMouseDown={() => {
                              if (!dtcCodes.includes(s.code)) setDtcCodes(prev => [...prev, s.code]);
                              setDtcInput(""); setDtcError(""); setDtcDropdown(false);
                            }} className={`w-full px-3 py-2 text-left flex gap-2 items-baseline hover:bg-blue-50 dark:hover:bg-slate-700 ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              <span className="font-mono font-bold text-[11px] shrink-0 text-amber-600">{s.code}</span>
                              <span className="text-[11px] text-slate-500 truncate">{s.desc}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {dtcError && <p className="text-[10px] text-red-400 mt-1">{dtcError}</p>}
                  {noDtc && <p className="text-[10px] text-amber-500 mt-1">⚠️ Без кода — описание симптомов особенно важно</p>}
                </div>

                {/* Symptoms chips — компактно */}
                <div className={`p-2 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">Симптомы</label>
                  <div className="flex flex-wrap gap-0.5 mb-1.5">
                    {SYMPTOM_CHIPS.map(chip => (
                      <button key={chip.id} onClick={() => toggleSymptom(chip.id)}
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border transition-all ${
                          symptoms.includes(chip.id)
                            ? isDark ? "bg-blue-600 border-blue-500 text-white" : "bg-blue-600 border-blue-600 text-white"
                            : isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
                        }`}>
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={1}
                    placeholder="Дополнительное описание (необязательно)..."
                    value={symptomText}
                    onChange={e => setSymptomText(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-xl text-xs border outline-none resize-none ${isDark ? "bg-slate-800 border-slate-700 text-slate-200 placeholder-slate-500" : "bg-white border-[#ddd8ce] text-slate-800 placeholder-slate-400"}`}
                  />
                </div>

                </div>
                {/* Кнопка прижата к низу */}
                <div className={`${isDesktop ? "pb-3 pt-1" : "pb-4 pt-1"} flex flex-col gap-1`}>
                  <button onClick={startChat} disabled={!problemReady}
                    className={`w-full font-extrabold rounded-2xl flex items-center justify-center gap-2 uppercase tracking-wider transition-all ${isDesktop ? "py-2 h-10 text-xs" : "py-2.5 h-11 text-[13px]"} ${
                      problemReady
                        ? isDark ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950" : "bg-[#7ec8f0] hover:bg-[#5cb8e8] text-white"
                        : "bg-slate-400 text-slate-200 cursor-not-allowed opacity-60"}`}>
                    <Sparkles className="w-4 h-4" /> Начать диагностику
                  </button>
                  <div className="flex justify-between px-1">
                    <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Укажите DTC-код или симптом
                    </p>
                    <p className={`text-[10px] font-semibold ${isDark ? "text-emerald-500" : "text-emerald-600"}`}>
                      Не решили — не платите
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ══ SCREEN: CHAT ══ */}
            {screen === "chat" && (
              <div className={`flex-1 overflow-hidden ${isDesktop ? "flex flex-row" : "flex flex-col"}`}>

                {/* Desktop sidebar */}
                {isDesktop && (
                  <aside className={`w-72 shrink-0 flex flex-col border-r overflow-y-auto ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-[#ddd8ce]"}`}>
                    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
                      {/* Vehicle */}
                      <div>
                        <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-slate-400">Автомобиль</p>
                        <p className={`text-sm font-extrabold ${isDark ? "text-white" : "text-slate-800"}`}>{brand} {model}</p>
                        <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>{year} г.&nbsp;·&nbsp;{engine || "—"}</p>
                      </div>
                      {/* DTC */}
                      {dtcCodes.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-slate-400">DTC-{dtcCodes.length > 1 ? "коды" : "код"}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {dtcCodes.map(c => (
                              <span key={c} className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Symptoms */}
                      {symptoms.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-slate-400">Симптомы</p>
                          <div className="flex flex-wrap gap-1">
                            {symptoms.map(s => (
                              <span key={s} className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                                {SYMPTOM_CHIPS.find(c => c.id === s)?.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Description */}
                      {symptomText && (
                        <div>
                          <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-slate-400">Описание</p>
                          <p className={`text-xs leading-relaxed ${isDark ? "text-slate-300" : "text-slate-600"}`}>{symptomText}</p>
                        </div>
                      )}
                      {/* Credits */}
                      {credits !== null && (
                        <div className={`text-xs font-bold ${credits > 0 ? "text-emerald-500" : "text-red-400"}`}>
                          Баланс: {credits} кредит{credits === 1 ? "" : credits > 4 ? "ов" : "а"}
                        </div>
                      )}
                    </div>
                    {/* Solve button */}
                    <div className="p-4 border-t shrink-0 border-slate-200 dark:border-slate-800">
                      <button onClick={goToConfirm}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
                        <CheckCircle2 className="w-4 h-4" /> Решено
                      </button>
                    </div>
                  </aside>
                )}

                {/* Main chat column */}
                <div className="flex-1 flex flex-col overflow-hidden">

                {/* Sub-header — mobile only */}
                {!isDesktop && <div className={`px-4 py-2 border-b flex items-center justify-between shrink-0 ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white/80 border-sky-100 shadow-sm"}`}>
                  <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                    {dtcCodes.slice(0, 2).map(c => (
                      <span key={c} className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded shrink-0 ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-50 text-amber-700"}`}>{c}</span>
                    ))}
                    {dtcCodes.length > 2 && <span className={`text-[10px] shrink-0 ${isDark ? "text-amber-500" : "text-amber-600"}`}>+{dtcCodes.length - 2}</span>}
                    {symptoms.slice(0, 2).map(s => (
                      <span key={s} className={`text-[10px] px-2 py-0.5 rounded ${isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
                        {SYMPTOM_CHIPS.find(c => c.id === s)?.label}
                      </span>
                    ))}
                    {symptoms.length > 2 && <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>+{symptoms.length - 2}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {credits !== null && (
                      <span className={`text-[10px] font-bold ${credits > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        баланс: {credits} кр.
                      </span>
                    )}
                    <button onClick={goToConfirm}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Решено
                    </button>
                  </div>
                </div>}

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

                {/* Inline chat error */}
                {chatError && (
                  <div className={`mx-3 mb-2 px-3 py-2.5 rounded-2xl border flex items-center gap-3 shrink-0 ${isDark ? "bg-red-900/20 border-red-800/50 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
                    <span className="text-sm shrink-0">⚠</span>
                    <span className="text-[11px] flex-1">{chatError.message}</span>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={async () => {
                        setChatError(null);
                        setLoading(true);
                        try {
                          const data = await _sendWithRetry(chatError.payload);
                          const reply = stripCaseSummary(data.reply || "Ошибка ответа сервера.");
                          if (data.fallback_model) setFallbackUsed(true);
                          const finalMsgs: Message[] = [...messages, { role: "assistant", content: reply }];
                          setMessages(finalMsgs);
                          _saveChatSession(finalMsgs);
                        } catch {
                          setChatError(prev => prev ? { ...prev, retryCount: (prev.retryCount || 0) + 1 } : null);
                        } finally { setLoading(false); }
                      }} className={`text-[11px] font-bold px-2 py-1 rounded-lg ${isDark ? "bg-red-800/40 hover:bg-red-800/60" : "bg-red-100 hover:bg-red-200"}`}>
                        Повторить
                      </button>
                      <button onClick={resetToStart} className={`text-[11px] font-bold px-2 py-1 rounded-lg ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-600"}`}>
                        Новая
                      </button>
                    </div>
                  </div>
                )}

                {/* Fallback model notice */}
                {fallbackUsed && !chatError && (
                  <div className={`mx-3 mb-1 text-center text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    резервная модель
                  </div>
                )}

                {/* Image preview */}
                {chatImage && (
                  <div className={`mx-3 mb-1 flex items-center gap-2 px-2 py-1.5 rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-blue-50 border-blue-100"}`}>
                    <span className="text-base">🖼</span>
                    <span className={`text-[11px] flex-1 truncate ${isDark ? "text-slate-300" : "text-slate-600"}`}>{chatImage.name}</span>
                    <button onClick={() => { setChatImage(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="text-slate-400 hover:text-red-400 text-xs px-1">✕</button>
                  </div>
                )}

                {/* Hidden file input */}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
                  className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageSelect(f); }} />

                {/* Input */}
                <div className={`px-3 py-3 border-t flex gap-2 items-end shrink-0 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-[#ddd8ce]"}`}>
                  <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 border ${
                      chatImage
                        ? "bg-blue-500 border-blue-500 text-white"
                        : isDark ? "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200" : "bg-white border-slate-200 text-slate-400 hover:text-slate-600"
                    }`} title="Прикрепить изображение">
                    {imageProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-base">📎</span>}
                  </button>
                  <textarea ref={inputRef} rows={1} value={input}
                    onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
                    placeholder={chatImage ? "Опишите что на изображении..." : "Напишите ответ и нажмите →"}
                    className={`flex-1 px-3 py-2.5 rounded-xl text-xs border outline-none resize-none transition-colors min-h-[40px] max-h-[100px] leading-relaxed ${isDark ? "bg-slate-800 border-slate-700 text-slate-200 focus:border-blue-500 placeholder-slate-500" : "bg-white border-[#ddd8ce] text-slate-800 focus:border-[#7ec8f0] placeholder-slate-400"}`}
                  />
                  <button onClick={sendMessage} disabled={(!input.trim() && !chatImage) || loading}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 ${(input.trim() || chatImage) && !loading ? "bg-[#7ec8f0] hover:bg-[#5cb8e8] text-white" : isDark ? "bg-slate-800 text-slate-600" : "bg-slate-200 text-slate-400"}`}>
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                </div>{/* end main chat column */}
              </div>
            )}

            {/* ══ SCREEN: CONFIRM ══ */}
            {screen === "confirm" && (
              <div className={`flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-8 ${isDesktop ? "max-w-2xl mx-auto w-full" : ""}`}>
                <div className="text-center py-2">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Подтверждение кейса
                  </div>
                </div>

                {/* Pre-filled block */}
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-3 tracking-wider">Данные кейса (заполнено автоматически)</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] text-slate-400 w-20 shrink-0 pt-0.5">Автомобиль</span>
                      <span className={`text-xs font-bold ${isDark ? "text-slate-200" : "text-slate-700"}`}>{brand} {model} {year}г. · {engine || "—"}</span>
                    </div>
                    {dtcCodes.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-slate-400 w-20 shrink-0 pt-0.5">{dtcCodes.length > 1 ? "DTC-коды" : "DTC-код"}</span>
                        <div className="flex flex-wrap gap-1">
                          {dtcCodes.map(c => (
                            <span key={c} className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-50 text-amber-700"}`}>{c}</span>
                          ))}
                        </div>
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
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-3 tracking-wider">Оцените ответ</p>
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
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
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
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
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
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Нормачасы</label>
                        <input type="number" min="0" step="0.5" placeholder="2"
                          value={laborHours} onChange={e => setLaborHours(e.target.value)}
                          className={fieldCls} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Ставка ₽/н/ч</label>
                        <input type="number" min="0" placeholder="1500"
                          value={laborRate} onChange={e => setLaborRate(e.target.value)}
                          className={fieldCls} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Стоимость работ</label>
                        <input type="text" readOnly
                          value={laborHours && laborRate ? `${(parseFloat(laborHours) * parseFloat(laborRate)).toLocaleString("ru-RU")} ₽` : ""}
                          className={`${fieldCls} opacity-70`} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
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
                <div className={`p-4 rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
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
                  {(totalWorksPrice + (parseFloat(laborHours) || 0) * (parseFloat(laborRate) || 0)) > 0 && (
                    <div className={`mt-4 pt-3 border-t ${isDark ? "border-slate-700" : "border-slate-200"}`}>
                      {laborHours && laborRate && (
                        <div className="flex justify-between items-center mb-1">
                          <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            Работы: {laborHours} н/ч × {parseFloat(laborRate).toLocaleString("ru-RU")} ₽
                          </span>
                          <span className="text-sm font-bold text-blue-400">{((parseFloat(laborHours) || 0) * (parseFloat(laborRate) || 0)).toLocaleString("ru-RU")} ₽</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold uppercase tracking-wider">Итого, предварительно:</span>
                        <span className="text-lg font-extrabold text-blue-500">
                          {(totalWorksPrice + (parseFloat(laborHours) || 0) * (parseFloat(laborRate) || 0)).toLocaleString("ru-RU")} ₽
                        </span>
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
                {!rootCause.trim() && <p className={`text-center text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>* Укажите причину чтобы сохранить</p>}
              </div>
            )}

            {/* ══ SCREEN: SOLVED ══ */}
            {screen === "solved" && (
              <div className={`flex-1 flex flex-col items-center justify-center px-6 text-center gap-5 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
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
                    className={`w-full py-4 rounded-2xl font-extrabold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${isDark ? "bg-[#7ec8f0] hover:bg-[#5cb8e8] text-white" : "bg-[#7ec8f0] hover:bg-[#5cb8e8] text-white shadow-md"}`}>
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

            {/* ══ SCREEN: TORQUE FORM ══ */}
            {screen === "torque_form" && (
              <div className={`flex-1 flex flex-col overflow-hidden px-4 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
                <button onClick={() => setScreen("menu")}
                  className={`flex items-center gap-1 text-xs font-semibold self-start px-1 py-0.5 rounded-lg transition-colors ${isDesktop ? "mt-1 mb-0.5" : "mt-2 mb-1"} ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Меню
                </button>
                <div className={`flex-1 overflow-y-auto pt-1 pb-2 flex flex-col ${isDesktop ? "gap-1.5" : "gap-2"}`}>
                  {/* Vehicle — same as diagnostics form */}
                  <div className={`${isDesktop ? "p-2" : "p-3"} rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                    <div className={`flex flex-col ${isDesktop ? "gap-1.5" : "gap-2"}`}>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Марка *</label>
                        <div className={`flex rounded-xl border overflow-hidden text-xs font-semibold mb-0.5 ${isDark ? "border-slate-700" : "border-slate-200"}`}>
                          <button type="button" onClick={() => { setBrandCategory("regular"); setBrand(""); setModel(""); setEngine(""); }}
                            className={`flex-1 py-1.5 transition-colors ${brandCategory === "regular" ? (isDark ? "bg-emerald-600 text-white" : "bg-[#7ec8f0] text-white") : (isDark ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500")}`}>Обычные</button>
                          <button type="button" onClick={() => { setBrandCategory("chinese"); setBrand(""); setModel(""); setEngine(""); }}
                            className={`flex-1 py-1.5 transition-colors ${brandCategory === "chinese" ? "bg-red-500 text-white" : (isDark ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500")}`}>🇨🇳 Китайские</button>
                        </div>
                        <select value={brand} onChange={e => { setBrand(e.target.value); setModel(""); setEngine(""); }} className={fieldCls}>
                          <option value="">Выберите марку...</option>
                          {(brandCategory === "chinese" ? CHINESE_BRANDS_LIST : Object.keys(VEHICLE_DATA)).map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Модель</label>
                        {getModels(brand).length > 0
                          ? <select value={model} onChange={e => { setModel(e.target.value); setEngine(""); }} className={fieldCls}>
                              <option value="">Выберите модель...</option>
                              {getModels(brand).map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          : <input type="text" placeholder="Введите модель" value={model} onChange={e => setModel(e.target.value)} className={fieldCls} />}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Год</label>
                          <input type="number" min="1990" max="2030" placeholder="2020" value={year} onChange={e => setYear(e.target.value)} className={fieldCls} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Двигатель</label>
                          {getEngines(brand, model).length > 0
                            ? <select value={engine} onChange={e => setEngine(e.target.value)} className={fieldCls}>
                                <option value="">Выбрать...</option>
                                {getEngines(brand, model).map(eng => <option key={eng} value={eng}>{eng}</option>)}
                              </select>
                            : <input type="text" placeholder="1ZZ-FE 1.8" value={engine} onChange={e => setEngine(e.target.value)} className={fieldCls} />}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Node selection */}
                  <div className={`${isDesktop ? "p-2" : "p-3"} rounded-3xl border ${isDark ? "bg-slate-900/40 border-slate-800/80" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Узел *</label>
                      <select value={torqueNode} onChange={e => setTorqueNode(e.target.value)} className={fieldCls}>
                        <option value="">Выберите узел...</option>
                        {TORQUE_NODES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className={`${isDesktop ? "pb-3 pt-1" : "pb-6 pt-2"}`}>
                  <button onClick={handleTorqueQuery} disabled={!brand || !torqueNode}
                    className={`w-full font-extrabold rounded-2xl flex items-center justify-center gap-2 uppercase tracking-wider transition-all ${isDesktop ? "py-2 h-10 text-xs" : "py-3.5 h-12 text-[14px]"} ${!brand || !torqueNode ? "bg-slate-400 text-slate-200 cursor-not-allowed opacity-60" : isDark ? "bg-amber-500 hover:bg-amber-600 text-slate-950" : "bg-amber-400 hover:bg-amber-500 text-white"}`}>
                    <span>📐</span> Получить моменты
                  </button>
                </div>
              </div>
            )}

            {/* ══ SCREEN: TORQUE RESULT ══ */}
            {screen === "torque_result" && (
              <div className={`flex-1 flex flex-col overflow-hidden px-4 ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
                <button onClick={() => setScreen("torque_form")}
                  className={`flex items-center gap-1 text-xs font-semibold self-start px-1 py-0.5 rounded-lg transition-colors ${isDesktop ? "mt-1 mb-0.5" : "mt-2 mb-1"} ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Назад
                </button>

                {/* Compact header */}
                <div className={`px-3 py-1.5 rounded-xl border text-[11px] flex items-center gap-2 mb-2 ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                  <span className="text-sm shrink-0">📐</span>
                  <span className={`font-semibold truncate ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {brand} {model}{engine ? ` · ${engine}` : ""} · <span className="font-bold">{TORQUE_NODES.find(n => n.id === torqueNode)?.label}</span>
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto pb-2 flex flex-col gap-2">
                  {/* Loading */}
                  {torqueLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10">
                      <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                      <p className={`text-sm font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Запрашиваю базу данных...</p>
                    </div>
                  )}

                  {/* Error */}
                  {torqueError && !torqueLoading && (
                    <div className={`p-3 rounded-2xl border text-sm ${isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-600"}`}>
                      {torqueError}
                    </div>
                  )}

                  {torqueResult && !torqueLoading && (
                    <>
                      {/* Блок 1: компактные значения в одну строку */}
                      <div className={`px-3 py-2 rounded-2xl border flex items-center gap-3 flex-wrap ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${torqueResult.confidence === "high" ? (isDark ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200") : (isDark ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200")}`}>
                          {torqueResult.confidence === "high" ? "✓ OLP" : "⚠ ИИ"}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[10px] font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>Момент:</span>
                          <span className={`text-sm font-black ${isDark ? "text-white" : "text-slate-800"}`}>{torqueResult.torque_nm.min}–{torqueResult.torque_nm.max}</span>
                          <span className={`text-[11px] font-bold text-[#7ec8f0]`}>Н·м</span>
                        </div>
                        {torqueResult.angle_degrees && (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-[10px] font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>Угол:</span>
                            <span className={`text-sm font-black ${isDark ? "text-amber-400" : "text-amber-600"}`}>+{torqueResult.angle_degrees}°</span>
                          </div>
                        )}
                        {torqueResult.bolt_class && (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-[10px] font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>Болт:</span>
                            <span className={`text-sm font-black ${isDark ? "text-slate-100" : "text-slate-800"}`}>{torqueResult.bolt_class}</span>
                          </div>
                        )}
                        {torqueResult.reusable !== null && torqueResult.reusable !== undefined && (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-[10px] font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>Повтор:</span>
                            <span className={`text-sm font-bold ${torqueResult.reusable ? "text-emerald-500" : "text-red-400"}`}>{torqueResult.reusable ? "Да" : "Нет"}</span>
                          </div>
                        )}
                      </div>

                      {/* Блок 2: схема порядка затяжки (всегда, по типу узла) */}
                      <div className={`p-3 rounded-2xl border ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                        <div className={`text-[10px] uppercase font-bold mb-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Порядок затяжки — крест-накрест</div>
                        <TorqueSVG node={torqueNode} patternData={torqueResult.pattern_data} />
                        <p className={`text-[10px] text-center mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          Цифра в круге — порядковый номер болта · стрелка — следующий шаг
                        </p>
                      </div>

                      {/* Блок 3: этапы затяжки по-русски */}
                      {torqueResult.stages && torqueResult.stages.length > 0 && (
                        <div className={`p-3 rounded-2xl border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-[#ddd8ce] shadow-sm"}`}>
                          <div className={`text-[10px] uppercase font-bold mb-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Этапы затяжки</div>
                          <div className="flex flex-col gap-1.5">
                            {torqueResult.stages.map((s, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${isDark ? "bg-amber-500/30 text-amber-400" : "bg-amber-100 text-amber-700"}`}>{i + 1}</span>
                                <span className={`text-[11px] font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>{s.value}</span>
                              </div>
                            ))}
                          </div>
                          <div className={`mt-2 pt-2 border-t text-[10px] leading-relaxed ${isDark ? "border-slate-800 text-slate-500" : "border-slate-100 text-slate-400"}`}>
                            Каждый этап — по схеме крест-накрест. Финальный момент — последний этап.
                          </div>
                        </div>
                      )}

                      {/* Note */}
                      {torqueResult.note && (
                        <div className={`px-3 py-2 rounded-xl text-[11px] ${isDark ? "bg-amber-500/5 border border-amber-500/20 text-amber-300" : "bg-amber-50 border border-amber-200 text-amber-800"}`}>
                          ⚠ {torqueResult.note}
                        </div>
                      )}

                      {torqueResult.confidence === "medium" && (
                        <p className={`text-[10px] text-center ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                          Сверьте с мануалом для ответственных узлов
                        </p>
                      )}
                    </>
                  )}
                </div>

                {!torqueLoading && (
                  <div className={`${isDesktop ? "pb-3 pt-1" : "pb-4 pt-1"}`}>
                    <button onClick={() => { setTorqueNode(""); setTorqueResult(null); setTorqueError(""); setScreen("torque_form"); }}
                      className={`w-full font-extrabold rounded-2xl flex items-center justify-center gap-2 uppercase tracking-wider transition-all ${isDesktop ? "py-2 h-10 text-xs" : "py-3 h-11 text-[13px]"} ${isDark ? "bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                      Другой узел
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ══ SCREEN: ASK (любой вопрос — Sonar Pro) ══ */}
            {screen === "ask" && (
              <div className={`flex-1 flex flex-col overflow-hidden ${isDesktop ? "max-w-xl mx-auto w-full" : ""}`}>
                <div className="px-4">
                  <button onClick={() => setScreen("menu")}
                    className={`flex items-center gap-1 text-xs font-semibold self-start px-1 py-0.5 rounded-lg transition-colors ${isDesktop ? "mt-1 mb-0.5" : "mt-2 mb-1"} ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
                    <ArrowLeft className="w-3.5 h-3.5" /> Меню
                  </button>
                </div>

                {/* Info bar */}
                <div className={`mx-4 mb-2 px-3 py-1.5 rounded-xl border text-[10px] flex items-center gap-2 ${isDark ? "bg-violet-500/5 border-violet-500/20 text-violet-300" : "bg-violet-50 border-violet-100 text-violet-700"}`}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  <span className="leading-tight">Поиск по актуальным данным. Один вопрос-сессия — 0.5 кредита.</span>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-3 py-1 flex flex-col gap-2">
                  {askMessages.length === 0 && !askLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-center px-6">
                      <Sparkles className={`w-8 h-8 ${isDark ? "text-violet-400/60" : "text-violet-300"}`} />
                      <p className={`text-sm font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Задайте любой рабочий вопрос</p>
                      <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                        Сравнить, узнать факт, найти взаимозаменяемость, регламент, артикул. Короткий точный ответ — без форумов и звонков.
                      </p>
                    </div>
                  )}
                  {askMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[88%] px-3 py-2.5 text-[12px] ${m.role === "user"
                        ? "rounded-2xl rounded-tr-sm bg-violet-600 text-white"
                        : `rounded-2xl rounded-tl-sm ${isDark ? "bg-slate-800 text-slate-200" : "bg-white border border-violet-100 text-slate-800 shadow-sm"}`}`}>
                        {renderContent(m.content)}
                      </div>
                    </div>
                  ))}
                  {askLoading && (
                    <div className="flex justify-start">
                      <div className={`px-4 py-3 rounded-2xl rounded-tl-sm text-xs flex items-center gap-2 ${isDark ? "bg-slate-800 text-slate-400" : "bg-white border border-violet-100 text-slate-500 shadow-sm"}`}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Ищу ответ...
                      </div>
                    </div>
                  )}
                  {askError && (
                    <div className={`p-3 rounded-2xl border text-xs ${isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-600"}`}>
                      {askError}
                    </div>
                  )}
                </div>

                {/* Limit reached banner */}
                {askLimitReached && (
                  <div className={`mx-3 mb-2 p-3 rounded-2xl border text-center ${isDark ? "bg-amber-500/10 border-amber-500/30" : "bg-amber-50 border-amber-200"}`}>
                    <p className={`text-[12px] font-semibold mb-2 ${isDark ? "text-amber-300" : "text-amber-800"}`}>
                      Лимит этой сессии исчерпан. Начните новый вопрос — будет списано ещё 0.5 кредита.
                    </p>
                    <button onClick={startNewAsk} disabled={credits === null || credits < 0.5}
                      className={`w-full py-2.5 rounded-xl font-extrabold text-[13px] uppercase tracking-wider transition-all ${(credits === null || credits < 0.5) ? "bg-slate-400 text-slate-200 opacity-60 cursor-not-allowed" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>
                      Новый вопрос (−0.5 кредита)
                    </button>
                  </div>
                )}

                {/* Input */}
                {!askLimitReached && (
                  <div className={`px-3 ${isDesktop ? "pb-3 pt-1" : "pb-4 pt-1"} flex items-end gap-2`}>
                    <textarea
                      value={askInput}
                      onChange={e => setAskInput(e.target.value)}
                      placeholder={askId ? "Уточнить или задать следующий вопрос..." : "Ваш вопрос..."}
                      rows={1}
                      disabled={askLoading || credits === null || credits < 0.5}
                      className={`flex-1 resize-none px-3 py-2.5 rounded-2xl text-[13px] border outline-none transition-colors max-h-28 ${isDark ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-violet-400" : "bg-white border-[#ddd8ce] text-slate-800 focus:border-violet-400"}`}
                    />
                    <button onClick={handleAskSend} disabled={!askInput.trim() || askLoading || credits === null || credits < 0.5}
                      className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${(!askInput.trim() || askLoading || credits === null || credits < 0.5) ? "bg-slate-400 text-slate-200 opacity-60 cursor-not-allowed" : "bg-violet-600 hover:bg-violet-700 text-white"}`}>
                      {askLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom toolbar — theme + desktop toggles */}
          <div className={`shrink-0 border-t flex items-center px-4 h-10 relative ${isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-[#ede9e1] border-[#ddd8ce] text-slate-600"}`}>
            <span className={`text-xs font-black tracking-tight ${isDark ? "text-blue-400" : "text-sky-500"}`}>2LS TOOLS</span>
            {screen === "code" && (
              <a href="tel:+79221800911"
                className={`absolute left-1/2 -translate-x-1/2 text-xs font-semibold ${isDark ? "text-sky-400" : "text-sky-600"}`}>
                +7 922 18 00 911
              </a>
            )}
            <div className="ml-auto flex items-center gap-2">
              {credits !== null && screen !== "code" && (
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${credits > 0 ? (isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-50 border border-emerald-100 text-emerald-700") : "bg-red-500/10 text-red-500"}`}>
                  <CreditCard className="w-2.5 h-2.5" />{credits}
                </div>
              )}
              <button
                onClick={() => {
                  const stateSnap = {
                    screen, brandCategory, brand, model, year, engine, vin, odometer,
                    dtcCodes, noDtc, symptoms, symptomText,
                    messages, sessionId, noAnswer,
                    rootCause, aiRating, toolsUsed, refValue,
                    clientName, clientPhone, clientCar, laborHours, laborRate, reportNote,
                    recommendedWorks,
                    serviceCode, serviceName,
                  };
                  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(stateSnap))));
                  const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`;
                  const tg = (window as any).Telegram?.WebApp;
                  if (tg?.openLink) { tg.openLink(url); }
                  else { window.open(url, "_blank"); }
                }}
                title="Открыть в браузере"
                className={`p-1.5 rounded-lg flex items-center justify-center transition-colors text-[14px] ${isDark ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
                📱
              </button>
              <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
                className={`p-1.5 rounded-lg flex items-center justify-center transition-colors ${isDark ? "text-amber-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}>
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
