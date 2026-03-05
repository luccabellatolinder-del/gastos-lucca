"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";

/** ===================== TIPOS ===================== */
type ExpenseCategory =
  | "GASOLINA"
  | "ALUGUEL"
  | "MERCADO"
  | "FARMÁCIA"
  | "GAMES"
  | "ROUPAS"
  | "CLÍNICA"
  | "CARRO"
  | "EVENTOS"
  | "ESPORTE"
  | "VIAGEM"
  | "OUTROS";

type ExpenseMethod = "DINHEIRO" | "PIX" | "DÉBITO" | "CRÉDITO" | "BOLETO";

type IncomeSource = "CLÍNICA" | "DOMICILIAR" | "OUTRO";
type IncomeMethod = "DINHEIRO" | "PIX" | "CRÉDITO" | "DÉBITO";

type Expense = {
  id: string;
  type: "expense";
  dateISO: string; // YYYY-MM-DD
  amount: number;
  category: ExpenseCategory;
  method: ExpenseMethod;
};

type Income = {
  id: string;
  type: "income";
  dateISO: string; // YYYY-MM-DD
  amount: number;
  source: IncomeSource;
  patientName?: string;
  method: IncomeMethod;
};

type Entry = Expense | Income;

type RecurringExpense = {
  id: string;
  name: string; // ex: "Aluguel"
  category: ExpenseCategory;
  method: ExpenseMethod;
  amount: number;
  dayOfMonth: number; // 1..31
  isActive: boolean;
};

type Budgets = Record<string, number>; // category => budget mensal
type Theme = "light" | "dark";
type Tone = "good" | "bad" | "neutral";

/** ===================== CONSTANTES ===================== */
const STORAGE_ENTRIES = "gastoslucca_entries_v6";
const STORAGE_BUDGETS = "gastoslucca_budgets_v1";
const STORAGE_RECUR = "gastoslucca_recurring_v1";
const STORAGE_THEME = "gastoslucca_theme_v1";
const STORAGE_CLOUD = "gastoslucca_cloud_v1";

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "GASOLINA",
  "ALUGUEL",
  "MERCADO",
  "FARMÁCIA",
  "GAMES",
  "ROUPAS",
  "CLÍNICA",
  "CARRO",
  "EVENTOS",
  "ESPORTE",
  "VIAGEM",
  "OUTROS",
];

const EXPENSE_METHODS: ExpenseMethod[] = ["DINHEIRO", "PIX", "DÉBITO", "CRÉDITO", "BOLETO"];
const INCOME_SOURCES: IncomeSource[] = ["CLÍNICA", "DOMICILIAR", "OUTRO"];
const INCOME_METHODS: IncomeMethod[] = ["DINHEIRO", "PIX", "CRÉDITO", "DÉBITO"];

/** ===================== HELPERS ===================== */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(dateISO: string) {
  return dateISO.slice(0, 7);
}
function dayOfMonth(dateISO: string) {
  return Number(dateISO.slice(8, 10));
}
function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pctChange(cur: number, prev: number) {
  if (prev === 0 && cur === 0) return 0;
  if (prev === 0) return 100;
  return ((cur - prev) / prev) * 100;
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function currentMonthKey() {
  return monthKey(todayISO());
}
function makeId() {
  return String(Date.now()) + Math.random().toString(16).slice(2);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${y}/${nomes[(m ?? 1) - 1] ?? "??"}`;
}
function pillStyle(tone: Tone, theme: Theme) {
  const base = {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800 as const,
  };
  if (tone === "good") return { ...base, background: "#16a34a", color: "white" };
  if (tone === "bad") return { ...base, background: "#dc2626", color: "white" };
  return { ...base, background: "#f59e0b", color: theme === "dark" ? "#111" : "#111" };
}
function toneFromNet(net: number): Tone {
  if (net > 0) return "good";
  if (net < 0) return "bad";
  return "neutral";
}
function toneForIncomeDelta(pct: number): Tone {
  if (pct > 0) return "good";
  if (pct < 0) return "bad";
  return "neutral";
}
// despesa subir é ruim / cair é bom
function toneForExpenseDelta(pct: number): Tone {
  if (pct > 0) return "bad";
  if (pct < 0) return "good";
  return "neutral";
}
function parseNumberBR(input: string) {
  const cleaned = input.replace(/\./g, "").replace(",", ".").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function toCSV(entries: Entry[]) {
  const header = ["id", "type", "dateISO", "amount", "category", "source", "patientName", "method"];
  const rows = entries.map((e) => {
    const base: any = {
      id: e.id,
      type: e.type,
      dateISO: e.dateISO,
      amount: e.amount,
      method: e.method,
      category: "",
      source: "",
      patientName: "",
    };
    if (e.type === "expense") base.category = e.category;
    if (e.type === "income") {
      base.source = e.source;
      base.patientName = e.patientName ?? "";
    }
    return header.map((k) => `"${String(base[k] ?? "").replace(/"/g, '""')}"`).join(",");
  });
  return header.join(",") + "\n" + rows.join("\n");
}

/** ===================== SUPABASE (NUVEM) ===================== */
let supabaseClient: any = null;
async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const mod = await import("@supabase/supabase-js");
    supabaseClient = mod.createClient(url, key);
    return supabaseClient;
  } catch {
    return null;
  }
}

/** ===================== COMPONENTE CARD (FORA DO PAGE!) ===================== */
type Styles = {
  pageBg: string;
  cardBg: string;
  text: string;
  muted: string;
  border: string;
  softBorder: string;
  btnBg: string;
  btnFg: string;
  btn2Bg: string;
  btn2Fg: string;
  inputBg: string;
};

function Card({
  styles,
  title,
  right,
  children,
}: {
  styles: Styles;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${styles.border}`, borderRadius: 14, padding: 14, background: styles.cardBg }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        <div style={{ marginLeft: "auto" }}>{right}</div>
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

/** ===================== PÁGINA ===================== */
export default function Page() {
  /** ---------- tema ---------- */
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_THEME) as Theme | null;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_THEME, theme);
  }, [theme]);

  const styles: Styles = useMemo(() => {
    const isDark = theme === "dark";
    return {
      pageBg: isDark ? "#0b1220" : "#ffffff",
      cardBg: isDark ? "#0f1b30" : "#ffffff",
      text: isDark ? "#e5e7eb" : "#111827",
      muted: isDark ? "rgba(229,231,235,0.7)" : "rgba(17,24,39,0.7)",
      border: isDark ? "rgba(255,255,255,0.10)" : "#e5e7eb",
      softBorder: isDark ? "rgba(255,255,255,0.08)" : "#eef2f7",
      btnBg: isDark ? "#e5e7eb" : "#111827",
      btnFg: isDark ? "#111827" : "white",
      btn2Bg: isDark ? "#0f1b30" : "white",
      btn2Fg: isDark ? "#e5e7eb" : "#111827",
      inputBg: isDark ? "#0b1220" : "white",
    };
  }, [theme]);

  /** ---------- dados ---------- */
  const [entries, setEntries] = useState<Entry[]>([]);
  const [budgets, setBudgets] = useState<Budgets>({});
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);

  /** ---------- UI estado ---------- */
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey());
  const [openMonth, setOpenMonth] = useState<string | null>(currentMonthKey());

  /** ---------- filtros ---------- */
  const [qText, setQText] = useState("");
  const [fType, setFType] = useState<"all" | "income" | "expense">("all");
  const [fMethod, setFMethod] = useState<string>("all");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fMin, setFMin] = useState<string>("");
  const [fMax, setFMax] = useState<string>("");
  const [fDateFrom, setFDateFrom] = useState<string>("");
  const [fDateTo, setFDateTo] = useState<string>("");

  /** ---------- nuvem ---------- */
  const [cloudEnabled, setCloudEnabled] = useState<boolean>(false);
  const [householdId, setHouseholdId] = useState<string>("");
  const [cloudStatus, setCloudStatus] = useState<string>("Nuvem: desligada");

  const importFileRef = useRef<HTMLInputElement | null>(null);

  /** ---------- forms: gastos ---------- */
  const [expenseAmount, setExpenseAmount] = useState<string>("");
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>("MERCADO");
  const [expenseMethod, setExpenseMethod] = useState<ExpenseMethod>("CRÉDITO");
  const [expenseUseCustomDate, setExpenseUseCustomDate] = useState<boolean>(false);
  const [expenseDate, setExpenseDate] = useState<string>(todayISO());

  /** ---------- forms: ganhos ---------- */
  const [incomeSource, setIncomeSource] = useState<IncomeSource>("CLÍNICA");
  const [incomeAmount, setIncomeAmount] = useState<string>("");
  const [patientName, setPatientName] = useState<string>("");
  const [incomeMethod, setIncomeMethod] = useState<IncomeMethod>("PIX");
  const [incomeUseCustomDate, setIncomeUseCustomDate] = useState<boolean>(false);
  const [incomeDate, setIncomeDate] = useState<string>(todayISO());

  /** ---------- form: recorrência ---------- */
  const [recName, setRecName] = useState("Aluguel");
  const [recAmount, setRecAmount] = useState("1000");
  const [recCategory, setRecCategory] = useState<ExpenseCategory>("ALUGUEL");
  const [recMethod, setRecMethod] = useState<ExpenseMethod>("BOLETO");
  const [recDay, setRecDay] = useState<number>(5);

  /** ---------- comparativo ---------- */
  const [compareResult, setCompareResult] = useState<null | {
    curMonth: string;
    prevMonth: string;
    day: number;
    curIncome: number;
    curExpense: number;
    prevIncome: number;
    prevExpense: number;
    curNet: number;
    prevNet: number;
  }>(null);

  /** ===================== LOAD LOCAL ===================== */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_ENTRIES);
      if (raw) {
        const parsed = JSON.parse(raw) as Entry[];
        if (Array.isArray(parsed)) setEntries(parsed);
      }
    } catch {}
    try {
      const raw = localStorage.getItem(STORAGE_BUDGETS);
      if (raw) {
        const parsed = JSON.parse(raw) as Budgets;
        if (parsed && typeof parsed === "object") setBudgets(parsed);
      }
    } catch {}
    try {
      const raw = localStorage.getItem(STORAGE_RECUR);
      if (raw) {
        const parsed = JSON.parse(raw) as RecurringExpense[];
        if (Array.isArray(parsed)) setRecurring(parsed);
      }
    } catch {}
    try {
      const raw = localStorage.getItem(STORAGE_CLOUD);
      if (raw) {
        const parsed = JSON.parse(raw) as { enabled: boolean; householdId: string };
        if (parsed && typeof parsed === "object") {
          setCloudEnabled(!!parsed.enabled);
          setHouseholdId(parsed.householdId ?? "");
        }
      }
    } catch {}
  }, []);

  /** ===================== SAVE LOCAL ===================== */
  useEffect(() => {
    localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem(STORAGE_BUDGETS, JSON.stringify(budgets));
  }, [budgets]);

  useEffect(() => {
    localStorage.setItem(STORAGE_RECUR, JSON.stringify(recurring));
  }, [recurring]);

  useEffect(() => {
    localStorage.setItem(STORAGE_CLOUD, JSON.stringify({ enabled: cloudEnabled, householdId }));
  }, [cloudEnabled, householdId]);

  /** ===================== MES/AGRUPAMENTO ===================== */
  const monthsAvailable = useMemo(() => {
    const set = new Set(entries.map((e) => monthKey(e.dateISO)));
    set.add(currentMonthKey());
    return Array.from(set).sort().reverse();
  }, [entries]);

  const entriesByMonth = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const mk = monthKey(e.dateISO);
      if (!map.has(mk)) map.set(mk, []);
      map.get(mk)!.push(e);
    }
    const cur = currentMonthKey();
    if (!map.has(cur)) map.set(cur, []);
    for (const [mk, list] of map.entries()) {
      list.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
      map.set(mk, list);
    }
    return map;
  }, [entries]);

  const entriesInMonth = useMemo(() => {
    return (entriesByMonth.get(selectedMonth) ?? []).slice();
  }, [entriesByMonth, selectedMonth]);

  /** ===================== FILTROS ===================== */
  const filteredMonthEntries = useMemo(() => {
    let list = entriesInMonth.slice();

    if (fType !== "all") list = list.filter((e) => e.type === fType);
    if (fMethod !== "all") list = list.filter((e) => e.method === fMethod);

    if (fCategory !== "all") {
      list = list.filter((e) => {
        if (e.type === "expense") return e.category === fCategory;
        return e.source === fCategory;
      });
    }

    const min = fMin.trim() ? parseNumberBR(fMin) : NaN;
    const max = fMax.trim() ? parseNumberBR(fMax) : NaN;
    if (Number.isFinite(min)) list = list.filter((e) => e.amount >= (min as number));
    if (Number.isFinite(max)) list = list.filter((e) => e.amount <= (max as number));

    if (fDateFrom.trim()) list = list.filter((e) => e.dateISO >= fDateFrom);
    if (fDateTo.trim()) list = list.filter((e) => e.dateISO <= fDateTo);

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        if (e.type === "expense") return `${e.category} ${e.method}`.toLowerCase().includes(q);
        const pn = e.patientName ?? "";
        return `${e.source} ${pn} ${e.method}`.toLowerCase().includes(q);
      });
    }

    return list;
  }, [entriesInMonth, fType, fMethod, fCategory, fMin, fMax, fDateFrom, fDateTo, qText]);

  /** ===================== TOTAIS / DELTAS ===================== */
  const totalsMonth = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of entriesInMonth) {
      if (e.type === "income") income += e.amount;
      else expense += e.amount;
    }
    return { income, expense, net: income - expense };
  }, [entriesInMonth]);

  const prevMonth = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }, [selectedMonth]);

  const totalsPrevMonth = useMemo(() => {
    const list = entriesByMonth.get(prevMonth) ?? [];
    let income = 0;
    let expense = 0;
    for (const e of list) {
      if (e.type === "income") income += e.amount;
      else expense += e.amount;
    }
    return { income, expense, net: income - expense };
  }, [entriesByMonth, prevMonth]);

  const deltas = useMemo(() => {
    return {
      incomePct: pctChange(totalsMonth.income, totalsPrevMonth.income),
      expensePct: pctChange(totalsMonth.expense, totalsPrevMonth.expense),
      netPct: pctChange(totalsMonth.net, totalsPrevMonth.net),
    };
  }, [totalsMonth, totalsPrevMonth]);

  /** ===================== LIMITe DIÁRIO ===================== */
  const dailyAllowance = useMemo(() => {
    const mk = currentMonthKey();
    const isCur = selectedMonth === mk;
    if (!isCur) return null;

    const now = new Date();
    const today = now.getDate();
    const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDays = Math.max(1, totalDays - today + 1);

    const remaining = totalsMonth.net;
    const perDay = remaining / remainingDays;

    return { remainingDays, remaining, perDay };
  }, [selectedMonth, totalsMonth]);

  /** ===================== GRÁFICOS (MÊS A MÊS) ===================== */
  const byMonth = useMemo(() => {
    const rows = monthsAvailable
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((mk) => {
        const list = entriesByMonth.get(mk) ?? [];
        let income = 0;
        let expense = 0;
        for (const e of list) {
          if (e.type === "income") income += e.amount;
          else expense += e.amount;
        }
        return { month: mk, income, expense, net: income - expense };
      });
    return rows;
  }, [monthsAvailable, entriesByMonth]);

  /** ===================== ONDE MAIS GASTO/RECEBO ===================== */
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entriesInMonth) {
      if (e.type !== "expense") continue;
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [entriesInMonth]);

  const incomeBySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entriesInMonth) {
      if (e.type !== "income") continue;
      map.set(e.source, (map.get(e.source) ?? 0) + e.amount);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [entriesInMonth]);

  /** ===================== ORÇAMENTOS ===================== */
  const budgetRows = useMemo(() => {
    const spentMap = new Map<string, number>();
    for (const e of entriesInMonth) {
      if (e.type !== "expense") continue;
      spentMap.set(e.category, (spentMap.get(e.category) ?? 0) + e.amount);
    }

    return EXPENSE_CATEGORIES.map((cat) => {
      const budget = Number(budgets[cat] ?? 0);
      const spent = Number(spentMap.get(cat) ?? 0);
      const ratio = budget > 0 ? spent / budget : 0;
      const pct = budget > 0 ? ratio * 100 : 0;

      let tone: Tone = "neutral";
      if (budget > 0) {
        if (ratio < 0.8) tone = "good";
        else if (ratio <= 1) tone = "neutral";
        else tone = "bad";
      }
      return { cat, budget, spent, pct, tone };
    }).filter((r) => r.budget > 0 || r.spent > 0);
  }, [entriesInMonth, budgets]);

  /** ===================== DETECÇÃO "FORA DO PADRÃO" ===================== */
  const anomalies = useMemo(() => {
    const monthsSortedAsc = monthsAvailable.slice().sort((a, b) => a.localeCompare(b));
    const selIndexAsc = monthsSortedAsc.indexOf(selectedMonth);
    const prev3 = monthsSortedAsc.slice(Math.max(0, selIndexAsc - 3), selIndexAsc);
    if (prev3.length === 0) return [];

    const avgMap = new Map<string, number>();
    for (const cat of EXPENSE_CATEGORIES) {
      let sum = 0;
      for (const mk of prev3) {
        const list = entriesByMonth.get(mk) ?? [];
        let spent = 0;
        for (const e of list) if (e.type === "expense" && e.category === cat) spent += e.amount;
        sum += spent;
      }
      avgMap.set(cat, sum / prev3.length);
    }

    const curMap = new Map<string, number>();
    for (const e of entriesInMonth) if (e.type === "expense") curMap.set(e.category, (curMap.get(e.category) ?? 0) + e.amount);

    const out: { cat: string; current: number; avg: number; ratio: number }[] = [];
    for (const [cat, cur] of curMap.entries()) {
      const avg = avgMap.get(cat) ?? 0;
      if (avg <= 0) continue;
      const ratio = cur / avg;
      if (ratio >= 1.5 && cur >= 150) out.push({ cat, current: cur, avg, ratio });
    }

    return out.sort((a, b) => b.ratio - a.ratio).slice(0, 6);
  }, [entriesByMonth, entriesInMonth, monthsAvailable, selectedMonth]);

  /** ===================== RECORRÊNCIAS ===================== */
  function ensureRecurrencesForMonth(mk: string) {
    const list = entriesByMonth.get(mk) ?? [];
    const existingSig = new Set<string>();
    for (const e of list) {
      if (e.type !== "expense") continue;
      if (e.id.startsWith("recur:")) {
        const parts = e.id.split(":");
        if (parts.length >= 3) existingSig.add(`${parts[1]}:${parts[2]}`);
      }
    }

    const [y, m] = mk.split("-").map(Number);
    const maxDay = new Date(y, m, 0).getDate();

    const newEntries: Entry[] = [];
    for (const r of recurring) {
      if (!r.isActive) continue;
      const day = clamp(r.dayOfMonth, 1, maxDay);
      const sig = `${r.id}:${mk}`;
      if (existingSig.has(sig)) continue;

      const dateISO = `${mk}-${String(day).padStart(2, "0")}`;

      const e: Expense = {
        id: `recur:${r.id}:${mk}`,
        type: "expense",
        dateISO,
        amount: r.amount,
        category: r.category,
        method: r.method,
      };
      newEntries.push(e);
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...newEntries, ...prev]);
      setOpenMonth(mk);
      setSelectedMonth(mk);
    }
  }

  useEffect(() => {
    ensureRecurrencesForMonth(currentMonthKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurring]);

  /** ===================== AÇÕES: ADD/REMOVE ===================== */
  function addExpense() {
    const amt = parseNumberBR(expenseAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert("Digite um valor de gasto válido.");
      return;
    }
    const dateISO = expenseUseCustomDate ? expenseDate : todayISO();
    const newItem: Expense = {
      id: makeId(),
      type: "expense",
      dateISO,
      amount: amt,
      category: expenseCategory,
      method: expenseMethod,
    };
    setEntries((prev) => [newItem, ...prev]);
    setExpenseAmount("");
    setCompareResult(null);
    const mk = monthKey(dateISO);
    setSelectedMonth(mk);
    setOpenMonth(mk);
  }

  function addIncome() {
    const amt = parseNumberBR(incomeAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert("Digite um valor de ganho válido.");
      return;
    }
    const dateISO = incomeUseCustomDate ? incomeDate : todayISO();
    const newItem: Income = {
      id: makeId(),
      type: "income",
      dateISO,
      amount: amt,
      source: incomeSource,
      patientName: patientName.trim() || undefined,
      method: incomeMethod,
    };
    setEntries((prev) => [newItem, ...prev]);
    setIncomeAmount("");
    setPatientName("");
    setCompareResult(null);
    const mk = monthKey(dateISO);
    setSelectedMonth(mk);
    setOpenMonth(mk);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setCompareResult(null);
  }

  function clearAll() {
    if (!confirm("Apagar TODOS os lançamentos, orçamentos e recorrências locais?")) return;
    setEntries([]);
    setBudgets({});
    setRecurring([]);
    setCompareResult(null);
  }

  /** ===================== GERAR COMPARATIVO ===================== */
  function gerarComparativo() {
    const now = todayISO();
    const mkCur = monthKey(now);
    const d = dayOfMonth(now);

    const [y, m] = mkCur.split("-").map(Number);
    const prevDate = new Date(y, m - 1, 1);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const mkPrev = prevDate.toISOString().slice(0, 7);

    const sumUpToDay = (mk: string) => {
      const list = entriesByMonth.get(mk) ?? [];
      let income = 0;
      let expense = 0;
      for (const e of list) {
        if (dayOfMonth(e.dateISO) > d) continue;
        if (e.type === "income") income += e.amount;
        else expense += e.amount;
      }
      return { income, expense, net: income - expense };
    };

    const cur = sumUpToDay(mkCur);
    const prev = sumUpToDay(mkPrev);

    setCompareResult({
      curMonth: mkCur,
      prevMonth: mkPrev,
      day: d,
      curIncome: cur.income,
      curExpense: cur.expense,
      prevIncome: prev.income,
      prevExpense: prev.expense,
      curNet: cur.net,
      prevNet: prev.net,
    });

    setSelectedMonth(mkCur);
    setOpenMonth(mkCur);
  }

  /** ===================== BACKUP / EXPORT / IMPORT ===================== */
  function exportJSON() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
      budgets,
      recurring,
    };
    downloadTextFile(`GastosLucca-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2));
  }

  function exportCSV() {
    downloadTextFile(`GastosLucca-lancamentos-${todayISO()}.csv`, toCSV(entries));
  }

  async function importJSONFile(file: File) {
    const text = await file.text();
    const payload = JSON.parse(text);

    if (!payload || typeof payload !== "object") throw new Error("Arquivo inválido.");

    const incomingEntries: Entry[] = Array.isArray(payload.entries) ? payload.entries : [];
    const incomingBudgets: Budgets = payload.budgets && typeof payload.budgets === "object" ? payload.budgets : {};
    const incomingRecurring: RecurringExpense[] = Array.isArray(payload.recurring) ? payload.recurring : [];

    const byId = new Map<string, Entry>();
    for (const e of entries) byId.set(e.id, e);
    for (const e of incomingEntries) {
      if (!e?.id) continue;
      byId.set(e.id, e);
    }
    setEntries(Array.from(byId.values()));

    setBudgets(incomingBudgets);

    const rById = new Map<string, RecurringExpense>();
    for (const r of recurring) rById.set(r.id, r);
    for (const r of incomingRecurring) if (r?.id) rById.set(r.id, r);
    setRecurring(Array.from(rById.values()));
  }

  /** ===================== NUVEM ===================== */
  async function cloudPull() {
    setCloudStatus("Nuvem: conectando...");
    const supa = await getSupabase();
    if (!supa) {
      setCloudStatus("Nuvem: configure ENV/Supabase.");
      return;
    }
    if (!householdId.trim()) {
      setCloudStatus("Nuvem: informe o Código.");
      return;
    }

    try {
      const { data, error } = await supa
        .from("entries")
        .select("entry_id, entry, updated_at")
        .eq("household_id", householdId.trim())
        .limit(5000);

      if (error) throw error;

      const incoming: Entry[] = (data ?? [])
        .map((row: any) => row.entry)
        .filter((x: any) => x && typeof x === "object" && typeof x.id === "string");

      const byId = new Map<string, Entry>();
      for (const e of entries) byId.set(e.id, e);
      for (const e of incoming) byId.set(e.id, e);

      setEntries(Array.from(byId.values()));
      setCloudStatus(`Nuvem: puxado (${incoming.length}).`);
    } catch (err: any) {
      setCloudStatus(`Nuvem: erro (${String(err?.message ?? err)}).`);
    }
  }

  async function cloudPush() {
    setCloudStatus("Nuvem: enviando...");
    const supa = await getSupabase();
    if (!supa) {
      setCloudStatus("Nuvem: configure ENV/Supabase.");
      return;
    }
    if (!householdId.trim()) {
      setCloudStatus("Nuvem: informe o Código.");
      return;
    }

    try {
      const rows = entries.map((e) => ({
        household_id: householdId.trim(),
        entry_id: e.id,
        entry: e,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supa.from("entries").upsert(rows, { onConflict: "household_id,entry_id" });
      if (error) throw error;

      setCloudStatus(`Nuvem: enviado (${rows.length}).`);
    } catch (err: any) {
      setCloudStatus(`Nuvem: erro (${String(err?.message ?? err)}).`);
    }
  }

  useEffect(() => {
    if (!cloudEnabled) {
      setCloudStatus("Nuvem: desligada");
      return;
    }
    cloudPull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudEnabled]);

  /** ===================== UI STYLES ===================== */
  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: `1px solid ${styles.border}`,
    background: styles.inputBg,
    color: styles.text,
    outline: "none",
  };

  const selectStyle: React.CSSProperties = { ...inputStyle };

  const primaryBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${styles.btnBg}`,
    background: styles.btnBg,
    color: styles.btnFg,
    cursor: "pointer",
    fontWeight: 800,
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${styles.border}`,
    background: styles.btn2Bg,
    color: styles.btn2Fg,
    cursor: "pointer",
    fontWeight: 800,
  };

  /** ===================== EXPORT / IMPORT UI ===================== */
  const importInput = (
    <>
      <button style={secondaryBtn} onClick={() => importFileRef.current?.click()}>
        Importar JSON
      </button>
      <input
        ref={importFileRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            await importJSONFile(file);
            alert("Importação concluída (mesclado).");
          } catch (err: any) {
            alert(`Falha ao importar: ${String(err?.message ?? err)}`);
          } finally {
            e.target.value = "";
          }
        }}
      />
    </>
  );

  /** ===================== RENDER ===================== */
  return (
    <div style={{ minHeight: "100vh", background: styles.pageBg, color: styles.text }}>
      <div style={{ maxWidth: 1250, margin: "0 auto", padding: 16, fontFamily: "system-ui, Segoe UI, Roboto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>GastosLucca</h1>
            <div style={{ marginTop: 6, color: styles.muted, fontSize: 13 }}>
              Verde = bom, vermelho = ruim, amarelo = moderado. Dados locais + opção de compartilhar.
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={secondaryBtn} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "☀️ Claro" : "🌙 Escuro"}
            </button>

            <button style={secondaryBtn} onClick={exportJSON}>Exportar JSON</button>
            <button style={secondaryBtn} onClick={exportCSV}>Exportar CSV</button>
            {importInput}
          </div>
        </div>

        {/* COMPARTILHAR (simplificado) */}
        <div style={{ marginTop: 12 }}>
          <Card
            styles={styles}
            title="Compartilhar"
            right={<span style={{ color: styles.muted, fontSize: 12 }}>{cloudStatus}</span>}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Ativar</span>
                <select
                  style={selectStyle}
                  value={cloudEnabled ? "on" : "off"}
                  onChange={(e) => setCloudEnabled(e.target.value === "on")}
                >
                  <option value="off">Desligado</option>
                  <option value="on">Ligado</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Código</span>
                <input
                  style={inputStyle}
                  value={householdId}
                  onChange={(e) => setHouseholdId(e.target.value)}
                  placeholder="Ex: LUCCA-2026"
                />
              </label>

              <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                <button style={primaryBtn} onClick={cloudPull} disabled={!cloudEnabled}>
                  Puxar
                </button>
                <button style={primaryBtn} onClick={cloudPush} disabled={!cloudEnabled}>
                  Enviar
                </button>
              </div>
            </div>
          </Card>
        </div>

        {/* FORMS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, marginTop: 12 }}>
          <Card styles={styles} title="Gastos">
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Valor</span>
                <input
                  style={inputStyle}
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="Ex: 120,50"
                  inputMode="decimal"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Onde gastei</span>
                <select style={selectStyle} value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value as ExpenseCategory)}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Como paguei</span>
                <select style={selectStyle} value={expenseMethod} onChange={(e) => setExpenseMethod(e.target.value as ExpenseMethod)}>
                  {EXPENSE_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", color: styles.muted }}>
                <input type="checkbox" checked={expenseUseCustomDate} onChange={(e) => setExpenseUseCustomDate(e.target.checked)} />
                Data anterior
              </label>
              <input
                type="date"
                style={{ ...inputStyle, opacity: expenseUseCustomDate ? 1 : 0.6 }}
                disabled={!expenseUseCustomDate}
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />

              <button style={primaryBtn} onClick={addExpense}>Adicionar gasto</button>
            </div>
          </Card>

          <Card styles={styles} title="Ganhos (salário)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Fonte</span>
                <select style={selectStyle} value={incomeSource} onChange={(e) => setIncomeSource(e.target.value as IncomeSource)}>
                  {INCOME_SOURCES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Valor</span>
                <input style={inputStyle} value={incomeAmount} onChange={(e) => setIncomeAmount(e.target.value)} placeholder="Ex: 200" inputMode="decimal" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Paciente</span>
                <input style={inputStyle} value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Nome (opcional)" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Como recebi</span>
                <select style={selectStyle} value={incomeMethod} onChange={(e) => setIncomeMethod(e.target.value as IncomeMethod)}>
                  {INCOME_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", color: styles.muted }}>
                <input type="checkbox" checked={incomeUseCustomDate} onChange={(e) => setIncomeUseCustomDate(e.target.checked)} />
                Data anterior
              </label>
              <input
                type="date"
                style={{ ...inputStyle, opacity: incomeUseCustomDate ? 1 : 0.6 }}
                disabled={!incomeUseCustomDate}
                value={incomeDate}
                onChange={(e) => setIncomeDate(e.target.value)}
              />

              <button style={primaryBtn} onClick={addIncome}>Adicionar ganho</button>
            </div>
          </Card>
        </div>

        {/* RESUMO */}
        <div style={{ marginTop: 12 }}>
          <Card
            styles={styles}
            title="Resumo e comparações"
            right={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={primaryBtn} onClick={gerarComparativo}>GERAR COMPARATIVO</button>
                <button style={secondaryBtn} onClick={clearAll}>Limpar tudo</button>
              </div>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Mês (gráficos/rankings)</span>
                <select style={selectStyle} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                  {monthsAvailable.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)} ({m})</option>
                  ))}
                </select>
              </label>

              <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                <div style={{ color: styles.muted, fontSize: 12 }}>Ganhos ({selectedMonth})</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatBRL(totalsMonth.income)}</div>
                <div style={pillStyle(toneForIncomeDelta(deltas.incomePct), theme)}>
                  {deltas.incomePct >= 0 ? "+" : ""}{deltas.incomePct.toFixed(1)}%
                </div>
              </div>

              <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                <div style={{ color: styles.muted, fontSize: 12 }}>Despesas ({selectedMonth})</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatBRL(totalsMonth.expense)}</div>
                <div style={pillStyle(toneForExpenseDelta(deltas.expensePct), theme)}>
                  {deltas.expensePct >= 0 ? "+" : ""}{deltas.expensePct.toFixed(1)}%
                </div>
              </div>

              <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                <div style={{ color: styles.muted, fontSize: 12 }}>Saldo</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatBRL(totalsMonth.net)}</div>
                <div style={pillStyle(toneFromNet(totalsMonth.net), theme)}>
                  {totalsMonth.net > 0 ? "LUCRO" : totalsMonth.net < 0 ? "PREJUÍZO" : "NEUTRO"}
                </div>
              </div>

              {dailyAllowance && (
                <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                  <div style={{ color: styles.muted, fontSize: 12 }}>Quanto posso gastar por dia</div>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{formatBRL(dailyAllowance.perDay)}</div>
                  <div style={pillStyle(toneFromNet(dailyAllowance.perDay), theme)}>
                    {dailyAllowance.remainingDays} dia(s) restantes
                  </div>
                </div>
              )}
            </div>

            {compareResult && (
              <div style={{ marginTop: 12, borderTop: `1px solid ${styles.softBorder}`, paddingTop: 12 }}>
                <div style={{ fontWeight: 900 }}>
                  Comparativo até o dia {compareResult.day}: {compareResult.curMonth} vs {compareResult.prevMonth}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
                  <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                    <div style={{ color: styles.muted, fontSize: 12 }}>Ganhos</div>
                    <div style={{ fontWeight: 900 }}>{formatBRL(compareResult.curIncome)}</div>
                    <div style={{ color: styles.muted, fontSize: 12 }}>Anterior: {formatBRL(compareResult.prevIncome)}</div>
                  </div>

                  <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                    <div style={{ color: styles.muted, fontSize: 12 }}>Despesas</div>
                    <div style={{ fontWeight: 900 }}>{formatBRL(compareResult.curExpense)}</div>
                    <div style={{ color: styles.muted, fontSize: 12 }}>Anterior: {formatBRL(compareResult.prevExpense)}</div>
                  </div>

                  <div style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                    <div style={{ color: styles.muted, fontSize: 12 }}>Saldo</div>
                    <div style={{ fontWeight: 900 }}>{formatBRL(compareResult.curNet)}</div>
                    <div style={{ color: styles.muted, fontSize: 12 }}>Anterior: {formatBRL(compareResult.prevNet)}</div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ORÇAMENTOS */}
        <div style={{ marginTop: 12 }}>
          <Card styles={styles} title="Orçamentos por categoria (mensal)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <label key={cat} style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: styles.muted }}>{cat} (limite)</span>
                  <input
                    style={inputStyle}
                    placeholder="0 (sem limite)"
                    value={String(budgets[cat] ?? "")}
                    onChange={(e) => {
                      const v = parseNumberBR(e.target.value);
                      setBudgets((prev) => ({ ...prev, [cat]: Number.isFinite(v) ? v : 0 }));
                    }}
                  />
                </label>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              {budgetRows.length === 0 ? (
                <div style={{ color: styles.muted }}>Defina limites (ou lance gastos) para ver as barras.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {budgetRows.map((r) => {
                    const pct = r.budget > 0 ? clamp(r.pct, 0, 200) : 0;
                    const tone = r.tone;
                    const barColor = tone === "good" ? "#16a34a" : tone === "bad" ? "#dc2626" : "#f59e0b";
                    return (
                      <div key={r.cat} style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ fontWeight: 900 }}>{r.cat}</div>
                          <div style={{ marginLeft: "auto" }}>
                            <span style={pillStyle(tone, theme)}>
                              {r.budget > 0 ? `${r.pct.toFixed(0)}%` : "sem limite"}
                            </span>
                          </div>
                        </div>

                        <div style={{ marginTop: 8, color: styles.muted, fontSize: 12 }}>
                          Gasto: <b style={{ color: styles.text }}>{formatBRL(r.spent)}</b>
                          {r.budget > 0 ? (
                            <>
                              {" "} / Limite: <b style={{ color: styles.text }}>{formatBRL(r.budget)}</b>
                            </>
                          ) : null}
                        </div>

                        {r.budget > 0 && (
                          <div style={{ marginTop: 8, height: 10, borderRadius: 999, background: theme === "dark" ? "rgba(255,255,255,0.08)" : "#f3f4f6" }}>
                            <div style={{ height: 10, width: `${pct}%`, borderRadius: 999, background: barColor }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* RECORRÊNCIAS */}
        <div style={{ marginTop: 12 }}>
          <Card
            styles={styles}
            title="Recorrências"
            right={
              <button style={secondaryBtn} onClick={() => ensureRecurrencesForMonth(currentMonthKey())}>
                Aplicar (mês atual)
              </button>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Nome</span>
                <input style={inputStyle} value={recName} onChange={(e) => setRecName(e.target.value)} placeholder="Ex: Aluguel" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Valor</span>
                <input style={inputStyle} value={recAmount} onChange={(e) => setRecAmount(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Categoria</span>
                <select style={selectStyle} value={recCategory} onChange={(e) => setRecCategory(e.target.value as ExpenseCategory)}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Método</span>
                <select style={selectStyle} value={recMethod} onChange={(e) => setRecMethod(e.target.value as ExpenseMethod)}>
                  {EXPENSE_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Dia do mês</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  max={31}
                  value={recDay}
                  onChange={(e) => setRecDay(Number(e.target.value))}
                />
              </label>

              <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
                <button
                  style={primaryBtn}
                  onClick={() => {
                    const amt = parseNumberBR(recAmount);
                    if (!Number.isFinite(amt) || amt <= 0) {
                      alert("Valor da recorrência inválido.");
                      return;
                    }
                    const d = clamp(Number(recDay), 1, 31);
                    const r: RecurringExpense = {
                      id: makeId(),
                      name: recName.trim() || "Recorrência",
                      category: recCategory,
                      method: recMethod,
                      amount: amt,
                      dayOfMonth: d,
                      isActive: true,
                    };
                    setRecurring((prev) => [r, ...prev]);
                  }}
                >
                  Adicionar
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {recurring.length === 0 ? (
                <div style={{ color: styles.muted }}>Nenhuma recorrência cadastrada.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {recurring.map((r) => (
                    <div key={r.id} style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900 }}>{r.name}</div>
                        <div style={{ color: styles.muted, fontSize: 12 }}>
                          {r.category} • {r.method} • dia {r.dayOfMonth} • {formatBRL(r.amount)}
                        </div>

                        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            style={secondaryBtn}
                            onClick={() => setRecurring((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: !x.isActive } : x)))}
                          >
                            {r.isActive ? "Desativar" : "Ativar"}
                          </button>

                          <button style={secondaryBtn} onClick={() => setRecurring((prev) => prev.filter((x) => x.id !== r.id))}>
                            Remover
                          </button>
                        </div>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <span style={pillStyle(r.isActive ? "good" : "neutral", theme)}>
                          {r.isActive ? "ATIVA" : "DESATIVADA"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* GRÁFICOS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, marginTop: 12 }}>
          <Card styles={styles} title="Lucro/Prejuízo (mês a mês)">
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
                  <Legend />
                  <Bar dataKey="net" name="Saldo (Ganhos - Despesas)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card styles={styles} title="Ganhos vs Despesas (mês a mês)">
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="income" name="Ganhos" />
                  <Line type="monotone" dataKey="expense" name="Despesas" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* RANKINGS + ALERTAS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, marginTop: 12 }}>
          <Card styles={styles} title={`Onde eu mais gasto (${selectedMonth})`}>
            {expensesByCategory.length === 0 ? (
              <div style={{ color: styles.muted }}>Sem gastos nesse mês.</div>
            ) : (
              <>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={expensesByCategory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
                      <Bar dataKey="value" name="Gasto" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Card>

          <Card styles={styles} title={`Onde eu mais recebo (${selectedMonth})`}>
            {incomeBySource.length === 0 ? (
              <div style={{ color: styles.muted }}>Sem ganhos nesse mês.</div>
            ) : (
              <>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={incomeBySource}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
                      <Bar dataKey="value" name="Ganho" fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Card>

          <Card styles={styles} title="Alertas (fora do padrão)">
            {anomalies.length === 0 ? (
              <div style={{ color: styles.muted }}>Sem alertas (precisa de histórico).</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {anomalies.map((a) => (
                  <div key={a.cat} style={{ border: `1px solid ${styles.border}`, borderRadius: 12, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900 }}>{a.cat}</div>
                      <span style={pillStyle("bad", theme)}>{a.ratio.toFixed(1)}x</span>
                      <div style={{ marginLeft: "auto", color: styles.muted, fontSize: 12 }}>
                        Atual: <b style={{ color: styles.text }}>{formatBRL(a.current)}</b> • Média:{" "}
                        <b style={{ color: styles.text }}>{formatBRL(a.avg)}</b>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* LANÇAMENTOS + FILTROS */}
        <div style={{ marginTop: 12 }}>
          <Card styles={styles} title="Lançamentos por mês (clique para abrir)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Busca</span>
                <input style={inputStyle} value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Ex: mercado, pix, João..." />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Tipo</span>
                <select style={selectStyle} value={fType} onChange={(e) => setFType(e.target.value as any)}>
                  <option value="all">Todos</option>
                  <option value="expense">Gastos</option>
                  <option value="income">Ganhos</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Método</span>
                <select style={selectStyle} value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
                  <option value="all">Todos</option>
                  {Array.from(new Set([...EXPENSE_METHODS, ...INCOME_METHODS])).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Categoria/Fonte</span>
                <select style={selectStyle} value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
                  <option value="all">Todas</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {INCOME_SOURCES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Valor mínimo</span>
                <input style={inputStyle} value={fMin} onChange={(e) => setFMin(e.target.value)} placeholder="Ex: 50" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Valor máximo</span>
                <input style={inputStyle} value={fMax} onChange={(e) => setFMax(e.target.value)} placeholder="Ex: 500" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Data de</span>
                <input style={inputStyle} type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: styles.muted }}>Data até</span>
                <input style={inputStyle} type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
              </label>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {monthsAvailable.map((mk) => {
                const isOpen = openMonth === mk;
                const list = entriesByMonth.get(mk) ?? [];

                return (
                  <div key={mk} style={{ border: `1px solid ${styles.softBorder}`, borderRadius: 12, overflow: "hidden" }}>
                    <button
                      onClick={() => {
                        setOpenMonth(isOpen ? null : mk);
                        setSelectedMonth(mk);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: 12,
                        border: "none",
                        background: styles.cardBg,
                        color: styles.text,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontWeight: 900,
                      }}
                    >
                      <span style={{ width: 22 }}>{isOpen ? "▼" : "▶"}</span>
                      <span>Lançamentos — {monthLabel(mk)} ({mk})</span>
                      <span style={{ marginLeft: "auto", color: styles.muted, fontWeight: 800 }}>
                        {list.length} item(ns)
                      </span>
                    </button>

                    {isOpen && (
                      <div style={{ padding: 12, borderTop: `1px solid ${styles.softBorder}` }}>
                        <div style={{ color: styles.muted, fontSize: 12, marginBottom: 8 }}>
                          Mostrando: <b style={{ color: styles.text }}>{filteredMonthEntries.length}</b> registro(s)
                        </div>

                        {filteredMonthEntries.length === 0 ? (
                          <div style={{ color: styles.muted }}>Sem lançamentos com esses filtros.</div>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ textAlign: "left" }}>
                                  <th style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>Data</th>
                                  <th style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>Tipo</th>
                                  <th style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>Detalhe</th>
                                  <th style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>Método</th>
                                  <th style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>Valor</th>
                                  <th style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }} />
                                </tr>
                              </thead>
                              <tbody>
                                {filteredMonthEntries.map((e) => (
                                  <tr key={e.id}>
                                    <td style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>{e.dateISO}</td>
                                    <td style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>
                                      {e.type === "income" ? "Ganho" : "Gasto"}
                                    </td>
                                    <td style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>
                                      {e.type === "income"
                                        ? `${e.source}${e.patientName ? ` — ${e.patientName}` : ""}`
                                        : e.category}
                                    </td>
                                    <td style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>{e.method}</td>
                                    <td style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}`, fontWeight: 900 }}>
                                      {formatBRL(e.amount)}
                                    </td>
                                    <td style={{ padding: 8, borderBottom: `1px solid ${styles.softBorder}` }}>
                                      <button style={secondaryBtn} onClick={() => removeEntry(e.id)}>Remover</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}