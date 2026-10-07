import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, CreditCard, LoaderCircle, LogOut, Menu, Pencil, Plus, PiggyBank, ReceiptText, Sparkles, Trash2, WalletCards, X } from "lucide-react";

import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { generateFinancialInsight } from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Tx = { id: string; description: string; amount: number; type: "income" | "expense"; transaction_date: string; reconciled: boolean; category_id: string | null; is_card_invoice: boolean; card_name: string | null };
type Category = { id: string; name: string; type: "income" | "expense"; color: string; icon: string };
type CardPurchase = { id: string; transaction_id: string; description: string; amount: number; purchase_date: string };
type DraftPurchase = { id: string; description: string; amount: string; purchaseDate: string };
type NewEntryKind = "expense" | "income" | "card";
type TransactionFilter = "all" | "income" | "expense" | "card";

const INVESTMENT_OPTIONS = ["Dólar", "CDB", "LCI", "LCA", "Tesouro direto", "Fundos imobiliários", "Ações", "Reserva de emergência"] as const;

const DEFAULT_EXPENSE_CATEGORIES = [
  "Alimentação",
  "Moradia",
  "Transporte",
  "Saúde",
  "Educação",
  "Lazer",
  "Contas e serviços",
  "Assinaturas",
  "Compras",
  "Impostos",
  "Pets",
  "Cartão de crédito",
  "Investimentos",
  "Outros",
];

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "ESF — Seu controle financeiro pessoal" },
    { name: "description", content: "Controle entradas, despesas, concilie lançamentos e receba análises financeiras personalizadas." },
    { property: "og:title", content: "ESF — Seu controle financeiro pessoal" },
    { property: "og:description", content: "Controle entradas, despesas, concilie lançamentos e receba análises financeiras personalizadas." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

function Index() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cardPurchases, setCardPurchases] = useState<CardPurchase[]>([]);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>("all");
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [newEntryKind, setNewEntryKind] = useState<NewEntryKind>("expense");
  const [month, setMonth] = useState(() => new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Tx | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<Tx | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const runInsight = useServerFn(generateFinancialInsight);

  async function loadData(id: string) {
    const [{ data: tx }, { data: cats }, { data: purchases }] = await Promise.all([
      supabase.from("transactions").select("id,description,amount,type,transaction_date,reconciled,category_id,is_card_invoice,card_name").eq("user_id", id).order("transaction_date", { ascending: false }),
      supabase.from("categories").select("id,name,type,color,icon").eq("user_id", id).order("name"),
      supabase.from("card_purchases").select("id,transaction_id,description,amount,purchase_date").eq("user_id", id).order("purchase_date", { ascending: false }),
    ]);
    setTransactions((tx ?? []) as Tx[]);
    setCategories((cats ?? []) as Category[]);
    setCardPurchases((purchases ?? []) as CardPurchase[]);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      setUserId(id);
      if (id) void loadData(id);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      const id = session?.user.id ?? null;
      setUserId(id);
      if (id) void loadData(id); else { setTransactions([]); setCategories([]); setCardPurchases([]); }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const monthTransactions = useMemo(() => transactions.filter((t) => {
    const d = new Date(`${t.transaction_date}T12:00:00`);
    return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
  }), [transactions, month]);
  const income = monthTransactions.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expenses = monthTransactions.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const monthlyReserve = monthTransactions.filter((t) => t.type === "expense" && t.description.startsWith("Reserva para investimentos (")).reduce((s, t) => s + Number(t.amount), 0);
  const balance = income - expenses;
  const filteredTransactions = useMemo(() => {
    const query = transactionSearch.trim().toLowerCase();
    return monthTransactions.filter((transaction) => {
      const category = categories.find((item) => item.id === transaction.category_id)?.name ?? "";
      const matchesSearch = !query || transaction.description.toLowerCase().includes(query) || (transaction.card_name ?? "").toLowerCase().includes(query) || category.toLowerCase().includes(query);
      const matchesFilter =
        transactionFilter === "all" ||
        (transactionFilter === "card" && transaction.is_card_invoice) ||
        (transactionFilter === "income" && transaction.type === "income") ||
        (transactionFilter === "expense" && transaction.type === "expense" && !transaction.is_card_invoice);
      return matchesSearch && matchesFilter;
    });
  }, [monthTransactions, categories, transactionSearch, transactionFilter]);
  const visibleTransactions = showAllTransactions || transactionSearch.trim() || transactionFilter !== "all" ? filteredTransactions : filteredTransactions.slice(0, 10);

  function openNewEntry(kind: NewEntryKind) {
    setNewEntryKind(kind);
    setDialogOpen(true);
  }
  const categoryTotals = categories.filter((c) => c.type === "expense").map((c) => ({ ...c, total: monthTransactions.filter((t) => t.category_id === c.id && t.type === "expense").reduce((s, t) => s + Number(t.amount), 0) })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const topCategory = categoryTotals[0];
  const chartData = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(month.getFullYear(), month.getMonth() - 5 + index, 1);
    const set = transactions.filter((t) => { const td = new Date(`${t.transaction_date}T12:00:00`); return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear(); });
    return { month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(d).replace(".", ""), entradas: set.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0), despesas: set.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0) };
  });
  const incomeRows = monthTransactions.filter((t) => t.type === "income");
  const cardRows = monthTransactions.filter((t) => t.is_card_invoice);
  const expenseRows = monthTransactions.filter((t) => t.type === "expense" && !t.is_card_invoice);
  const pendingCount = monthTransactions.filter((t) => !t.reconciled).length;
  const openExpenseTotal = expenseRows.filter((t) => !t.reconciled).reduce((sum, t) => sum + Number(t.amount), 0);
  const updatedLabel = new Intl.DateTimeFormat("pt-BR").format(new Date());

  function expensePriority(transaction: Tx) {
    const categoryName = categories.find((category) => category.id === transaction.category_id)?.name ?? "";
    if (transaction.description.startsWith("Reserva para investimentos (") || categoryName === "Investimentos") return "IMPORTANTE";
    if (["Moradia", "Saúde", "Alimentação", "Transporte", "Contas e serviços", "Impostos", "Educação"].includes(categoryName)) return "ESSENCIAL";
    if (["Lazer", "Assinaturas", "Compras"].includes(categoryName)) return "NÃO ESSENCIAL";
    return "IMPORTANTE";
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault(); setAuthError("");
    const result = authMode === "login" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    if (result.error) setAuthError(result.error.message);
    else if (authMode === "signup" && !result.data.session) setAuthError("Confira seu e-mail para confirmar o cadastro.");
  }

  if (loading) return <div className="grid min-h-screen place-items-center"><LoaderCircle className="size-7 animate-spin text-primary" /></div>;
  if (!userId) return <AuthScreen mode={authMode} setMode={setAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} error={authError} onSubmit={handleAuth} />;
  const currentUserId = userId;

  async function getOrCreateCategory(name: string, type: "income" | "expense") {
    const normalizedName = name.trim();
    const local = categories.find((item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase() && item.type === type);
    if (local) return local;

    const { data: existing } = await supabase.from("categories").select("id,name,type,color,icon").eq("user_id", currentUserId).eq("type", type).ilike("name", normalizedName).maybeSingle();
    if (existing) return existing as Category;

    const { data, error } = await supabase.from("categories").insert({ user_id: currentUserId, name: normalizedName, type, color: type === "income" ? "green" : "blue", icon: "tag" }).select("id,name,type,color,icon").single();
    if (error || !data) throw error ?? new Error("Não foi possível criar a categoria.");
    return data as Category;
  }

  async function saveTransaction(event: FormEvent<HTMLFormElement>, purchases: DraftPurchase[]) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedType = String(form.get("type"));
    const isCardInvoice = selectedType === "card";
    const type = (isCardInvoice ? "expense" : selectedType) as "income" | "expense";
    const categoryName = String(form.get("category")).trim();
    let category: Category;
    try { category = await getOrCreateCategory(categoryName, type); }
    catch (categoryError) { setNotice(categoryError instanceof Error ? categoryError.message : "Não foi possível criar a categoria."); return; }
    const invoiceAmount = Number(form.get("amount"));
    const reserveInvestment = type === "income" && form.get("reserveInvestment") === "on";
    const investmentPercentRaw = reserveInvestment ? Number(form.get("investmentPercent")) : 0;
    const investmentType = reserveInvestment ? String(form.get("investmentType")) : "";
    if (reserveInvestment && (!Number.isFinite(investmentPercentRaw) || investmentPercentRaw <= 0 || investmentPercentRaw > 100 || !INVESTMENT_OPTIONS.some((option) => option === investmentType))) {
      setNotice("Escolha um investimento e um percentual maior que 0 e até 100%.");
      return;
    }
    const investmentPercent = Math.min(100, Math.max(0, investmentPercentRaw || 0));
    const investmentAmount = reserveInvestment ? invoiceAmount * (investmentPercent / 100) : 0;
    const validPurchases = purchases.filter((purchase) => purchase.description.trim() && Number(purchase.amount) > 0);
    if (isCardInvoice && validPurchases.length === 0) { setNotice("Adicione pelo menos uma compra à fatura."); return; }
    const { data: transaction, error } = await supabase.from("transactions").insert({ user_id: currentUserId, category_id: category.id, description: isCardInvoice ? `Fatura ${String(form.get("cardName")).trim()}` : String(form.get("description")), amount: invoiceAmount, type, transaction_date: String(form.get("date")), reconciled: false, is_card_invoice: isCardInvoice, card_name: isCardInvoice ? String(form.get("cardName")).trim() : null }).select("id").single();
    if (error || !transaction) { setNotice(error?.message ?? "Não foi possível salvar o lançamento."); return; }
    if (isCardInvoice) {
      const { error: purchaseError } = await supabase.from("card_purchases").insert(validPurchases.map((purchase) => ({ transaction_id: transaction.id, user_id: currentUserId, description: purchase.description.trim(), amount: Number(purchase.amount), purchase_date: purchase.purchaseDate })));
      if (purchaseError) {
        await supabase.from("transactions").delete().eq("id", transaction.id);
        setNotice("Não foi possível salvar as compras. A fatura não foi cadastrada.");
        return;
      }
    }
    if (type === "income" && reserveInvestment && investmentAmount > 0) {
      try {
        const investmentCategory = await getOrCreateCategory("Investimentos", "expense");
        const { error: investmentError } = await supabase.from("transactions").insert({
          user_id: currentUserId,
          category_id: investmentCategory.id,
          description: `Reserva para investimentos (${investmentPercent}%) — ${investmentType} — ${String(form.get("description")).trim()}`,
          amount: Number(investmentAmount.toFixed(2)),
          type: "expense",
          transaction_date: String(form.get("date")),
          reconciled: false,
          is_card_invoice: false,
          card_name: null,
        });
        if (investmentError) throw investmentError;
      } catch (investmentError) {
        setNotice(investmentError instanceof Error ? `Entrada salva, mas a reserva não foi criada: ${investmentError.message}` : "Entrada salva, mas a reserva para investimentos não foi criada.");
        await loadData(currentUserId);
        setDialogOpen(false);
        return;
      }
    }
    setDialogOpen(false);
    setNotice(isCardInvoice ? "Fatura e compras adicionadas." : type === "income" && reserveInvestment && investmentAmount > 0 ? `Entrada adicionada e ${money.format(investmentAmount)} reservados para investimentos.` : "Lançamento adicionado.");
    await loadData(currentUserId);
  }

  async function reconcile(id: string) {
    const { error } = await supabase.from("transactions").update({ reconciled: true }).eq("id", id);
    if (error) setNotice(error.message); else { setNotice("Gasto conferido."); await loadData(currentUserId); }
  }

  async function deleteTransaction(transaction: Tx) {
    if (!window.confirm(`Excluir o lançamento “${transaction.description}”? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("transactions").delete().eq("id", transaction.id);
    if (error) { setNotice(error.message); return; }
    if (invoiceDetail?.id === transaction.id) setInvoiceDetail(null);
    setNotice("Lançamento excluído."); await loadData(currentUserId);
  }

  async function updateTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTransaction) return;
    const form = new FormData(event.currentTarget);
    const categoryName = String(form.get("category")).trim();
    const type = editingTransaction.type;
    let category: Category;
    try { category = await getOrCreateCategory(categoryName, type); }
    catch (categoryError) { setNotice(categoryError instanceof Error ? categoryError.message : "Não foi possível criar a categoria."); return; }
    const cardName = editingTransaction.is_card_invoice ? String(form.get("cardName")).trim() : null;
    const { error } = await supabase.from("transactions").update({
      category_id: category.id,
      description: editingTransaction.is_card_invoice ? `Fatura ${cardName}` : String(form.get("description")).trim(),
      amount: editingTransaction.is_card_invoice ? editingTransaction.amount : Number(form.get("amount")),
      transaction_date: String(form.get("date")),
      card_name: cardName,
      reconciled: String(form.get("reconciled")) === "true",
    }).eq("id", editingTransaction.id);
    if (error) { setNotice(error.message); return; }
    setEditingTransaction(null); setNotice("Lançamento atualizado."); await loadData(currentUserId);
  }

  async function syncInvoiceTotal(transactionId: string) {
    const { data, error } = await supabase.from("card_purchases").select("amount").eq("transaction_id", transactionId).eq("user_id", currentUserId);
    if (error) throw error;
    const total = (data ?? []).reduce((sum, item) => sum + Number(item.amount), 0);
    const { error: updateError } = await supabase.from("transactions").update({ amount: total }).eq("id", transactionId).eq("user_id", currentUserId);
    if (updateError) throw updateError;
  }

  async function updateCardPurchase(event: FormEvent<HTMLFormElement>, purchase: CardPurchase) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get("description")).trim();
    const amount = Number(form.get("amount"));
    const purchaseDate = String(form.get("purchaseDate"));
    if (!description || amount <= 0 || !purchaseDate) { setNotice("Preencha os dados da compra corretamente."); return; }
    const { error } = await supabase.from("card_purchases").update({ description, amount, purchase_date: purchaseDate }).eq("id", purchase.id).eq("user_id", currentUserId);
    if (error) { setNotice(error.message); return; }
    try { await syncInvoiceTotal(purchase.transaction_id); }
    catch (syncError) { setNotice(syncError instanceof Error ? syncError.message : "Compra atualizada, mas não foi possível recalcular a fatura."); await loadData(currentUserId); return; }
    setNotice("Compra atualizada e total da fatura recalculado."); await loadData(currentUserId);
  }

  async function deleteCardPurchase(purchase: CardPurchase) {
    if (!window.confirm(`Excluir a compra “${purchase.description}” desta fatura? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("card_purchases").delete().eq("id", purchase.id).eq("user_id", currentUserId);
    if (error) { setNotice(error.message); return; }
    try { await syncInvoiceTotal(purchase.transaction_id); }
    catch (syncError) { setNotice(syncError instanceof Error ? syncError.message : "Compra removida, mas não foi possível recalcular a fatura."); await loadData(currentUserId); return; }
    setNotice("Compra removida e total da fatura recalculado."); await loadData(currentUserId);
  }

  async function askAI() {
    setInsightLoading(true); setNotice("");
    const today = new Date().toISOString().slice(0, 10);
    const overdueAmount = monthTransactions.filter((transaction) => transaction.type === "expense" && !transaction.reconciled && transaction.transaction_date < today).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const pendingReconciliations = monthTransactions.filter((transaction) => !transaction.reconciled).length;
    const cardInvoiceTotal = monthTransactions.filter((transaction) => transaction.is_card_invoice).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    try {
      const result = await runInsight({ data: { income, expenses, balance, monthlyReserve, overdueAmount, pendingReconciliations, cardInvoiceTotal, topCategory: topCategory?.name ?? "Sem despesas", topCategoryAmount: topCategory?.total ?? 0 } });
      setInsight(result.text);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível gerar a análise."); }
    finally { setInsightLoading(false); }
  }

  return (
    <main className="min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="sticky top-4 z-30 flex items-center justify-between rounded-3xl border border-glass-border bg-glass px-4 py-3 shadow-glass backdrop-blur-xl sm:px-6">
          <a href="#resumo" className="flex items-center gap-3"><Logo /><div><p className="font-display text-xl font-bold leading-none">ESF</p><p className="mt-1 text-[10px] font-semibold uppercase text-muted-foreground">Controle financeiro</p></div></a>
          <nav className="hidden items-center gap-1 rounded-2xl border border-glass-border bg-glass p-1 text-sm font-medium md:flex">
            {[['resumo','Visão geral'],['movimentos','Movimentos'],['relatorios','Relatórios'],['conciliacao','Conciliações'],['ia','Insights IA']].map(([id,label]) => <a key={id} href={`#${id}`} className="rounded-xl px-3 py-2 text-muted-foreground transition hover:bg-glass-strong hover:text-foreground">{label}</a>)}
          </nav>
          <div className="flex gap-2"><Button variant="glass" className="hidden rounded-xl sm:inline-flex" onClick={() => openNewEntry("expense")}><Plus />Novo lançamento</Button><Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</Button><Button variant="ghost" size="icon" aria-label="Sair" onClick={() => supabase.auth.signOut()}><LogOut /></Button></div>
          {mobileMenu && <nav className="absolute left-4 right-4 top-[76px] grid gap-1 rounded-2xl border border-glass-border bg-glass-strong p-2 shadow-glass backdrop-blur-xl md:hidden">{[['resumo','Visão geral'],['movimentos','Movimentos'],['relatorios','Relatórios'],['conciliacao','Conciliações'],['ia','Insights IA']].map(([id,label]) => <a key={id} href={`#${id}`} onClick={() => setMobileMenu(false)} className="rounded-xl px-4 py-3 text-sm font-medium">{label}</a>)}</nav>}
        </header>

        <section id="resumo" className="scroll-mt-28 pt-6">
          <div className="overflow-hidden rounded-[28px] border border-glass-border bg-glass shadow-glass backdrop-blur-xl">
            <div className="flex flex-col gap-5 bg-gradient-to-r from-sky-200 via-blue-100 to-cyan-100 px-6 py-7 text-slate-800 sm:flex-row sm:items-end sm:justify-between sm:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">ESF • Controle financeiro pessoal</p>
                <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Orçamento Pessoal {month.getFullYear()}</h1>
                <p className="mt-1 text-sm capitalize text-slate-600">{monthLabel.format(month)} • visão consolidada do mês</p>
              </div>
              <div className="flex flex-col items-start gap-3 sm:items-end">
                <p className="text-xs text-slate-600">Atualizado em {updatedLabel}</p>
                <div className="flex items-center gap-1 rounded-xl bg-white/55 p-1">
                  <Button variant="ghost" size="icon" className="text-slate-700 hover:bg-white/60 hover:text-slate-900" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
                  <span className="min-w-32 text-center text-sm font-semibold capitalize">{monthLabel.format(month)}</span>
                  <Button variant="ghost" size="icon" className="text-slate-700 hover:bg-white/60 hover:text-slate-900" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
              <BudgetMetric label="Entradas" value={income} helper={`${incomeRows.length} lançamento${incomeRows.length === 1 ? "" : "s"}`} tone="income" icon={<ArrowUp className="size-4"/>}/>
              <BudgetMetric label="Saídas" value={expenses} helper={`${expenseRows.length + cardRows.length} compromisso${expenseRows.length + cardRows.length === 1 ? "" : "s"}`} tone="expense" icon={<ArrowDown className="size-4"/>}/>
              <BudgetMetric label="Saldo projetado" value={balance} helper={balance >= 0 ? "Resultado positivo no mês" : "Saídas acima das entradas"} tone={balance >= 0 ? "income" : "expense"} icon={<WalletCards className="size-4"/>}/>
              <BudgetMetric label="Investimentos" value={monthlyReserve} helper={income > 0 ? `${((monthlyReserve / income) * 100).toFixed(1).replace(".", ",")}% das entradas` : "Sem entradas no período"} tone="primary" icon={<PiggyBank className="size-4"/>}/>
            </div>
          </div>
        </section>

        <section id="movimentos" className="mt-6 scroll-mt-28">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
            <BudgetTableCard
              title="Entradas do mês"
              subtitle="Receitas previstas e já confirmadas"
              action={<Button variant="glass" size="sm" className="rounded-xl" onClick={() => openNewEntry("income")}><Plus/>Entrada</Button>}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead><tr className="bg-gradient-to-r from-sky-200 via-blue-100 to-cyan-100 text-slate-800"><th className="px-4 py-3 font-semibold">DATA</th><th className="px-4 py-3 font-semibold">DESCRIÇÃO</th><th className="px-4 py-3 text-right font-semibold">VALOR</th><th className="px-4 py-3 text-center font-semibold">STATUS</th><th className="w-12 px-2 py-3"></th></tr></thead>
                  <tbody className="divide-y divide-border/70">
                    {incomeRows.length ? incomeRows.map((t) => <tr key={t.id} className="bg-white/35 transition hover:bg-white/60">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${t.transaction_date}T12:00:00`))}</td>
                      <td className="px-4 py-3 font-medium">{t.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{money.format(Number(t.amount))}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge ok={t.reconciled} okText="CONFIRMADO" pendingText="PREVISTO"/></td>
                      <td className="px-2 py-2"><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setEditingTransaction(t)} aria-label={`Editar ${t.description}`}><Pencil className="size-4"/></Button></td>
                    </tr>) : <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma entrada cadastrada neste mês.</td></tr>}
                  </tbody>
                </table>
              </div>
            </BudgetTableCard>

            <div className="grid gap-6">
              <BudgetTableCard
                title="Cartões"
                subtitle="Faturas e vencimentos do mês"
                action={<Button variant="glass" size="sm" className="rounded-xl" onClick={() => openNewEntry("card")}><Plus/>Fatura</Button>}
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead><tr className="bg-gradient-to-r from-sky-200 via-blue-100 to-cyan-100 text-slate-800"><th className="px-4 py-3 font-semibold">CARTÃO</th><th className="px-4 py-3 font-semibold">VENC.</th><th className="px-4 py-3 text-right font-semibold">TOTAL</th><th className="px-4 py-3 text-center font-semibold">STATUS</th></tr></thead>
                    <tbody className="divide-y divide-border/70">
                      {cardRows.length ? cardRows.map((t) => <tr key={t.id} className="bg-white/35 transition hover:bg-white/60">
                        <td className="px-4 py-3"><button type="button" className="font-semibold hover:text-primary" onClick={() => setInvoiceDetail(t)}>{t.card_name || t.description}</button><button type="button" className="mt-1 block text-[11px] font-medium text-primary" onClick={() => setInvoiceDetail(t)}>Ver compras ({cardPurchases.filter((purchase) => purchase.transaction_id === t.id).length})</button></td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${t.transaction_date}T12:00:00`))}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{money.format(Number(t.amount))}</td>
                        <td className="px-4 py-3 text-center"><StatusBadge ok={t.reconciled} okText="PAGO" pendingText="EM ABERTO"/></td>
                      </tr>) : <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma fatura neste mês.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </BudgetTableCard>

              <article className="rounded-3xl border border-glass-border bg-glass p-5 shadow-glass backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="font-display text-lg font-bold">Rotina de controle</p><p className="text-xs text-muted-foreground">Resumo rápido para acompanhar o mês</p></div>
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Check className="size-5"/></span>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  <ControlRow label="Reserva para investimentos" value={money.format(monthlyReserve)} />
                  <ControlRow label="Pendências para conciliar" value={String(pendingCount)} />
                  <ControlRow label="Despesas ainda em aberto" value={money.format(openExpenseTotal)} />
                  <ControlRow label="Maior categoria de gasto" value={topCategory?.name ?? "Sem despesas"} />
                </div>
              </article>
            </div>
          </div>

          <BudgetTableCard
            className="mt-6"
            title="Despesas e compromissos"
            subtitle="Contas, despesas e reservas organizadas por vencimento"
            action={<Button variant="glass" size="sm" className="rounded-xl" onClick={() => openNewEntry("expense")}><Plus/>Despesa</Button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead><tr className="bg-gradient-to-r from-sky-200 via-blue-100 to-cyan-100 text-slate-800"><th className="px-4 py-3 font-semibold">VENC.</th><th className="px-4 py-3 font-semibold">DESPESA</th><th className="px-4 py-3 font-semibold">CATEGORIA</th><th className="px-4 py-3 text-right font-semibold">VALOR</th><th className="px-4 py-3 font-semibold">PRIORIDADE</th><th className="px-4 py-3 text-center font-semibold">STATUS</th><th className="w-12 px-2 py-3"></th></tr></thead>
                <tbody className="divide-y divide-border/70">
                  {expenseRows.length ? expenseRows.map((t) => {
                    const cat = categories.find((item) => item.id === t.category_id);
                    return <tr key={t.id} className="bg-white/35 transition hover:bg-white/60">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${t.transaction_date}T12:00:00`))}</td>
                      <td className="px-4 py-3 font-medium">{t.description}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{cat?.name ?? "Sem categoria"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{money.format(Number(t.amount))}</td>
                      <td className="px-4 py-3"><PriorityBadge value={expensePriority(t)} /></td>
                      <td className="px-4 py-3 text-center"><StatusBadge ok={t.reconciled} okText="PAGO" pendingText="EM ABERTO"/></td>
                      <td className="px-2 py-2"><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setEditingTransaction(t)} aria-label={`Editar ${t.description}`}><Pencil className="size-4"/></Button></td>
                    </tr>;
                  }) : <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma despesa cadastrada neste mês.</td></tr>}
                </tbody>
              </table>
            </div>
          </BudgetTableCard>

          <article className="mt-6 rounded-3xl border border-glass-border bg-glass p-4 shadow-glass backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div><h2 className="font-display text-xl font-bold">Gerenciar lançamentos</h2><p className="text-xs text-muted-foreground">Use busca e filtros para localizar qualquer item rapidamente.</p></div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="glass" className="rounded-xl" onClick={() => openNewEntry("income")}><ArrowUp />Receita</Button>
                <Button variant="glass" className="rounded-xl" onClick={() => openNewEntry("expense")}><ArrowDown />Despesa</Button>
                <Button variant="glass" className="rounded-xl" onClick={() => openNewEntry("card")}><CreditCard />Fatura</Button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
              <Input value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Buscar por nome, cartão ou categoria..." className="h-11 rounded-xl bg-glass-strong"/>
              <div className="flex flex-wrap gap-2">{([["all","Todos"],["income","Receitas"],["expense","Despesas"],["card","Faturas"]] as const).map(([value,label]) => <Button key={value} type="button" variant={transactionFilter === value ? "hero" : "glass"} size="sm" className="rounded-xl" onClick={() => setTransactionFilter(value)}>{label}</Button>)}</div>
            </div>
            <div className="mt-4 grid gap-2">
              {visibleTransactions.length ? visibleTransactions.map((t) => {
                const cat = categories.find((item) => item.id === t.category_id);
                const purchaseCount = t.is_card_invoice ? cardPurchases.filter((purchase) => purchase.transaction_id === t.id).length : 0;
                return <div key={t.id} className="grid gap-3 rounded-2xl border border-glass-border bg-white/30 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                  <span className={`grid size-9 place-items-center rounded-xl ${t.type === "income" ? "bg-income/10 text-income" : "bg-expense/10 text-expense"}`}>{t.is_card_invoice ? <CreditCard className="size-4"/> : t.type === "income" ? <ArrowUp className="size-4"/> : <ArrowDown className="size-4"/>}</span>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{t.description}</p><p className="text-xs text-muted-foreground">{cat?.name ?? "Sem categoria"} • {new Intl.DateTimeFormat("pt-BR").format(new Date(`${t.transaction_date}T12:00:00`))}</p>{t.is_card_invoice && <button type="button" className="mt-1 text-xs font-semibold text-primary" onClick={() => setInvoiceDetail(t)}>Ver compras ({purchaseCount})</button>}</div>
                  <div className="flex items-center justify-between gap-2 sm:justify-end"><span className={`font-display text-sm font-bold ${t.type === "income" ? "text-income" : "text-expense"}`}>{t.type === "income" ? "+" : "-"} {money.format(Number(t.amount))}</span><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setEditingTransaction(t)}><Pencil className="size-4"/></Button></div>
                </div>;
              }) : <p className="py-8 text-center text-sm text-muted-foreground">Nenhum lançamento encontrado.</p>}
            </div>
            {filteredTransactions.length > 10 && !transactionSearch.trim() && transactionFilter === "all" && <div className="mt-4 flex justify-center"><Button type="button" variant="glass" className="rounded-xl" onClick={() => setShowAllTransactions((current) => !current)}>{showAllTransactions ? "Mostrar menos" : `Ver todos (${filteredTransactions.length})`}</Button></div>}
          </article>

          <article id="ia" className="mt-6 scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-6 shadow-glass backdrop-blur-xl">
            <div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl bg-hero text-primary-foreground"><Sparkles className="size-4"/></span><div><p className="font-display text-sm font-bold uppercase text-primary">Insights IA</p><p className="text-xs text-muted-foreground">Análise baseada nos dados completos do mês.</p></div></div>
            <div className="mt-4 min-h-36 rounded-2xl bg-glass-strong p-4"><p className="text-sm font-semibold">Seu plano financeiro</p>{insight ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{insight}</p> : <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Analiso saldo, despesas, reservas, vencimentos, faturas e categorias para sugerir os próximos passos.</p>}</div>
            <Button variant="hero" className="mt-4 rounded-xl" onClick={askAI} disabled={insightLoading}>{insightLoading ? <LoaderCircle className="animate-spin"/> : <Sparkles/>}Gerar plano personalizado</Button>
            <p className="mt-3 text-[10px] text-muted-foreground">Sugestões educativas. Investimentos envolvem riscos.</p>
          </article>
        </section>

        <ReportsSection
          month={month}
          transactions={transactions}
          categories={categories}
          cardPurchases={cardPurchases}
          monthTransactions={monthTransactions}
          categoryTotals={categoryTotals}
          income={income}
          expenses={expenses}
          balance={balance}
          monthlyReserve={monthlyReserve}
        />

        <section id="conciliacao" className="my-6 scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-4 shadow-glass backdrop-blur-xl sm:p-6"><div className="flex items-center justify-between"><div><h2 className="font-display text-xl font-bold">Conciliações</h2><p className="text-xs text-muted-foreground">Marque o que você já confirmou no extrato ou na fatura.</p></div><span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold">{monthTransactions.filter((t) => !t.reconciled).length} pendentes</span></div><div className="mt-4 grid gap-3 md:grid-cols-2">{monthTransactions.filter((t) => !t.reconciled).map((t) => <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-glass-strong p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{t.description}</p><p className="text-xs text-muted-foreground">{money.format(Number(t.amount))}</p></div><Button variant="glass" size="sm" className="rounded-xl" onClick={() => reconcile(t.id)}><Check />Conciliar</Button></div>)}</div></section>
      </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-brand">{notice}<button className="ml-4" onClick={() => setNotice("")} aria-label="Fechar aviso">×</button></div>}
      <TransactionDialog open={dialogOpen} setOpen={setDialogOpen} initialKind={newEntryKind} categories={categories} onSave={saveTransaction} />
      <EditTransactionDialog transaction={editingTransaction} category={categories.find((c) => c.id === editingTransaction?.category_id)?.name ?? ""} onClose={() => setEditingTransaction(null)} onSave={updateTransaction} onDelete={() => editingTransaction && deleteTransaction(editingTransaction)} />
      <InvoiceDetailDialog invoice={invoiceDetail} purchases={cardPurchases.filter((purchase) => purchase.transaction_id === invoiceDetail?.id)} onClose={() => setInvoiceDetail(null)} onSavePurchase={updateCardPurchase} onDeletePurchase={deleteCardPurchase} />
    </main>
  );
}


function ReportsSection({ month, transactions, categories, cardPurchases, monthTransactions, categoryTotals, income, expenses, balance, monthlyReserve }: {
  month: Date;
  transactions: Tx[];
  categories: Category[];
  cardPurchases: CardPurchase[];
  monthTransactions: Tx[];
  categoryTotals: Array<Category & { total: number }>;
  income: number;
  expenses: number;
  balance: number;
  monthlyReserve: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthExpenses = monthTransactions.filter((transaction) => transaction.type === "expense");
  const monthIncomes = monthTransactions.filter((transaction) => transaction.type === "income");
  const confirmedExpenses = monthExpenses.filter((transaction) => transaction.reconciled);
  const openExpenses = monthExpenses.filter((transaction) => !transaction.reconciled && transaction.transaction_date >= today);
  const overdueExpenses = monthExpenses.filter((transaction) => !transaction.reconciled && transaction.transaction_date < today);
  const confirmedTotal = confirmedExpenses.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const openTotal = openExpenses.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const overdueTotal = overdueExpenses.reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  const previousMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const previousTransactions = transactions.filter((transaction) => {
    const date = new Date(transaction.transaction_date + "T12:00:00");
    return date.getMonth() === previousMonth.getMonth() && date.getFullYear() === previousMonth.getFullYear();
  });
  const previousIncome = previousTransactions.filter((transaction) => transaction.type === "income").reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const previousExpenses = previousTransactions.filter((transaction) => transaction.type === "expense").reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const previousBalance = previousIncome - previousExpenses;
  const balanceDifference = balance - previousBalance;

  const invoices = monthExpenses.filter((transaction) => transaction.is_card_invoice);
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const invoicePurchases = cardPurchases.filter((purchase) => invoiceIds.has(purchase.transaction_id));
  const invoicesTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const purchasesTotal = invoicePurchases.reduce((sum, purchase) => sum + Number(purchase.amount), 0);
  const cardTotals = Array.from(invoices.reduce((map, invoice) => {
    const name = invoice.card_name || "Cartão não informado";
    map.set(name, (map.get(name) || 0) + Number(invoice.amount));
    return map;
  }, new Map<string, number>())).sort((a, b) => b[1] - a[1]);

  const expenseMonths = new Map<string, Set<string>>();
  transactions.filter((transaction) => transaction.type === "expense" && !transaction.description.startsWith("Reserva para investimentos (")).forEach((transaction) => {
    const key = transaction.description.trim().toLocaleLowerCase("pt-BR");
    const months = expenseMonths.get(key) || new Set<string>();
    months.add(transaction.transaction_date.slice(0, 7));
    expenseMonths.set(key, months);
  });
  const recurringKeys = new Set(Array.from(expenseMonths.entries()).filter(([, months]) => months.size >= 2).map(([key]) => key));
  const recurringExpenses = monthExpenses.filter((transaction) => recurringKeys.has(transaction.description.trim().toLocaleLowerCase("pt-BR")));
  const recurringTotal = recurringExpenses.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const variableTotal = Math.max(0, expenses - recurringTotal);
  const recurringGroups = Array.from(recurringExpenses.reduce((map, transaction) => {
    const key = transaction.description.trim().toLocaleLowerCase("pt-BR");
    const current = map.get(key) || { label: transaction.description, total: 0 };
    current.total += Number(transaction.amount);
    map.set(key, current);
    return map;
  }, new Map<string, { label: string; total: number }>()).values()).sort((a, b) => b.total - a.total);

  const incomeSources = categories.filter((category) => category.type === "income").map((category) => ({
    name: category.name,
    total: monthIncomes.filter((transaction) => transaction.category_id === category.id).reduce((sum, transaction) => sum + Number(transaction.amount), 0),
  })).filter((source) => source.total > 0).sort((a, b) => b.total - a.total);
  const receivedIncome = monthIncomes.filter((transaction) => transaction.transaction_date <= today).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const expectedIncome = monthIncomes.filter((transaction) => transaction.transaction_date > today).reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  const reserveHistory = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth() - 5 + index, 1);
    const total = transactions.filter((transaction) => {
      const transactionDate = new Date(transaction.transaction_date + "T12:00:00");
      return transaction.type === "expense" && transaction.description.startsWith("Reserva para investimentos (") && transactionDate.getMonth() === date.getMonth() && transactionDate.getFullYear() === date.getFullYear();
    }).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    return { label: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""), total };
  });
  const maxReserve = Math.max(1, ...reserveHistory.map((item) => item.total));

  const reconciledTransactions = monthTransactions.filter((transaction) => transaction.reconciled);
  const pendingTransactions = monthTransactions.filter((transaction) => !transaction.reconciled);
  const reconciledValue = reconciledTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const pendingValue = pendingTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const reconciliationRate = monthTransactions.length ? Math.round((reconciledTransactions.length / monthTransactions.length) * 100) : 0;

  const futureIncome = monthIncomes.filter((transaction) => transaction.transaction_date > today).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const futureExpenses = monthExpenses.filter((transaction) => transaction.transaction_date > today).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const monthName = monthLabel.format(month);

  return <section id="relatorios" className="mt-6 scroll-mt-28">
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-muted-foreground">Análises detalhadas</p><h2 className="font-display text-3xl font-bold">Relatórios</h2></div><span className="w-fit rounded-full border border-glass-border bg-glass px-3 py-1 text-xs font-semibold capitalize">{monthName}</span></div>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <ReportCard title="1. Resumo mensal" subtitle="Entradas, despesas, reserva e saldo do período.">
        <div className="grid grid-cols-2 gap-3"><ReportMetric label="Recebido" value={money.format(income)} tone="income"/><ReportMetric label="Gasto" value={money.format(expenses)} tone="expense"/><ReportMetric label="Reservado" value={money.format(monthlyReserve)} tone="primary"/><ReportMetric label="Saldo" value={money.format(balance)} tone={balance >= 0 ? "income" : "expense"}/></div>
        <p className="mt-4 text-xs text-muted-foreground">Comparado ao mês anterior: <strong className={balanceDifference >= 0 ? "text-income" : "text-expense"}>{balanceDifference >= 0 ? "+" : ""}{money.format(balanceDifference)}</strong>.</p>
      </ReportCard>

      <ReportCard title="2. Despesas por categoria" subtitle="Participação de cada categoria no total gasto.">
        <div className="space-y-4">{categoryTotals.slice(0, 6).map((category) => <ReportBar key={category.id} label={category.name} value={category.total} ratio={expenses ? category.total / expenses : 0}/>)}</div>
        {!categoryTotals.length && <ReportEmpty text="Nenhuma despesa no mês selecionado."/>}
      </ReportCard>

      <ReportCard title="3. Situação das contas" subtitle="Estimativa baseada na data e na conciliação do lançamento.">
        <div className="grid gap-3"><ReportStatus label="Pagas / confirmadas" count={confirmedExpenses.length} value={confirmedTotal} tone="income"/><ReportStatus label="Em aberto" count={openExpenses.length} value={openTotal} tone="warning"/><ReportStatus label="Vencidas" count={overdueExpenses.length} value={overdueTotal} tone="expense"/></div>
        <p className="mt-3 text-[11px] text-muted-foreground">Uma conta conciliada é considerada confirmada. As demais são classificadas pela data do lançamento.</p>
      </ReportCard>

      <ReportCard title="4. Faturas de cartão" subtitle="Totais por cartão e conferência das compras.">
        <div className="grid grid-cols-2 gap-3"><ReportMetric label="Faturas" value={String(invoices.length)} tone="primary"/><ReportMetric label="Total" value={money.format(invoicesTotal)} tone="expense"/><ReportMetric label="Compras" value={money.format(purchasesTotal)} tone="default"/><ReportMetric label="Diferença" value={money.format(Math.abs(invoicesTotal - purchasesTotal))} tone={Math.abs(invoicesTotal - purchasesTotal) < 0.005 ? "income" : "warning"}/></div>
        <div className="mt-4 space-y-2">{cardTotals.slice(0, 4).map(([name, total]) => <div key={name} className="flex justify-between text-sm"><span className="truncate text-muted-foreground">{name}</span><strong>{money.format(total)}</strong></div>)}</div>
        {!invoices.length && <ReportEmpty text="Nenhuma fatura cadastrada neste mês."/>}
      </ReportCard>

      <ReportCard title="5. Reservas e investimentos" subtitle="Evolução do valor separado nos últimos seis meses.">
        <p className="font-display text-3xl font-bold text-primary">{money.format(monthlyReserve)}</p><p className="text-xs text-muted-foreground">{income > 0 ? ((monthlyReserve / income) * 100).toFixed(1).replace(".", ",") : "0"}% da renda do mês.</p>
        <div className="mt-4 flex h-28 items-end gap-2">{reserveHistory.map((item) => <div key={item.label} className="flex flex-1 flex-col items-center gap-1"><span className="text-[10px] font-semibold">{item.total ? money.format(item.total) : "—"}</span><div className="w-full rounded-t-lg bg-primary/70" style={{ height: Math.max(6, (item.total / maxReserve) * 72) }}/><span className="text-[10px] uppercase text-muted-foreground">{item.label}</span></div>)}</div>
      </ReportCard>

      <ReportCard title="6. Receitas" subtitle="Valores recebidos, previstos e principais origens.">
        <div className="grid grid-cols-2 gap-3"><ReportMetric label="Recebidas até hoje" value={money.format(receivedIncome)} tone="income"/><ReportMetric label="Previstas" value={money.format(expectedIncome)} tone="primary"/></div>
        <div className="mt-4 space-y-3">{incomeSources.slice(0, 5).map((source) => <ReportBar key={source.name} label={source.name} value={source.total} ratio={income ? source.total / income : 0} tone="income"/>)}</div>
        {!monthIncomes.length && <ReportEmpty text="Nenhuma receita no mês selecionado."/>}
      </ReportCard>

      <ReportCard title="7. Fixas e variáveis" subtitle="Despesas repetidas em meses diferentes são consideradas fixas.">
        <div className="grid grid-cols-2 gap-3"><ReportMetric label="Fixas" value={money.format(recurringTotal)} tone="primary"/><ReportMetric label="Variáveis" value={money.format(variableTotal)} tone="warning"/></div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-warning/30"><div className="h-full bg-primary" style={{ width: (expenses ? recurringTotal / expenses * 100 : 0) + "%" }}/></div>
        <p className="mt-2 text-xs text-muted-foreground">{expenses ? Math.round(recurringTotal / expenses * 100) : 0}% das despesas são recorrentes.</p>
      </ReportCard>

      <ReportCard title="8. Recorrências e assinaturas" subtitle="Lançamentos com o mesmo nome em dois ou mais meses.">
        <p className="font-display text-2xl font-bold">{money.format(recurringTotal)} <span className="text-sm font-medium text-muted-foreground">por mês</span></p><p className="text-xs text-muted-foreground">Projeção anual: {money.format(recurringTotal * 12)}</p>
        <div className="mt-4 divide-y divide-border">{recurringGroups.slice(0, 6).map((item) => <div key={item.label} className="flex justify-between gap-3 py-2 text-sm"><span className="truncate">{item.label}</span><strong>{money.format(item.total)}</strong></div>)}</div>
        {!recurringGroups.length && <ReportEmpty text="Ainda não há repetições suficientes para identificar recorrências."/>}
      </ReportCard>

      <ReportCard title="9. Conciliações" subtitle="Acompanhamento do que foi conferido no extrato ou na fatura.">
        <div className="flex items-end justify-between"><div><p className="font-display text-4xl font-bold text-primary">{reconciliationRate}%</p><p className="text-xs text-muted-foreground">dos lançamentos conciliados</p></div><p className="text-sm font-semibold">{reconciledTransactions.length}/{monthTransactions.length}</p></div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-glass-strong"><div className="h-full rounded-full bg-primary" style={{ width: reconciliationRate + "%" }}/></div>
        <div className="mt-4 grid grid-cols-2 gap-3"><ReportMetric label="Conciliado" value={money.format(reconciledValue)} tone="income"/><ReportMetric label="Pendente" value={money.format(pendingValue)} tone="warning"/></div>
      </ReportCard>

      <ReportCard title="10. Previsão do mês" subtitle="Saldo final considerando tudo que já foi lançado para o mês." className="md:col-span-2 xl:col-span-3">
        <div className="grid gap-3 sm:grid-cols-3"><ReportMetric label="Saldo previsto" value={money.format(balance)} tone={balance >= 0 ? "income" : "expense"}/><ReportMetric label="Receitas futuras" value={money.format(futureIncome)} tone="income"/><ReportMetric label="Despesas futuras" value={money.format(futureExpenses)} tone="expense"/></div>
        <p className={"mt-4 rounded-2xl p-4 text-sm font-medium " + (balance >= 0 ? "bg-income/10 text-income" : "bg-expense/10 text-expense")}>{balance >= 0 ? "A previsão indica saldo positivo ao final do mês." : "Atenção: os lançamentos atuais indicam saldo negativo ao final do mês."}</p>
      </ReportCard>
    </div>
  </section>;
}

function ReportCard({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  return <article className={"rounded-3xl border border-glass-border bg-glass p-5 shadow-glass backdrop-blur-xl " + className}><h3 className="font-display text-lg font-bold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{subtitle}</p><div className="mt-5">{children}</div></article>;
}

function ReportMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "income" | "expense" | "primary" | "warning" }) {
  const tones = { default: "text-foreground", income: "text-income", expense: "text-expense", primary: "text-primary", warning: "text-warning" };
  return <div className="rounded-2xl bg-glass-strong p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className={"mt-1 font-display text-base font-bold " + tones[tone]}>{value}</p></div>;
}

function ReportBar({ label, value, ratio, tone = "primary" }: { label: string; value: number; ratio: number; tone?: "primary" | "income" }) {
  return <div><div className="flex justify-between gap-3 text-xs font-medium"><span className="truncate">{label}</span><span className="shrink-0 text-muted-foreground">{money.format(value)}</span></div><div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-glass-strong"><div className={tone === "income" ? "h-full rounded-full bg-income" : "h-full rounded-full bg-primary"} style={{ width: Math.max(5, Math.min(100, ratio * 100)) + "%" }}/></div></div>;
}

function ReportStatus({ label, count, value, tone }: { label: string; count: number; value: number; tone: "income" | "warning" | "expense" }) {
  const tones = { income: "bg-income/10 text-income", warning: "bg-warning/15 text-warning", expense: "bg-expense/10 text-expense" };
  return <div className={"flex items-center justify-between rounded-2xl p-3 " + tones[tone]}><div><p className="text-sm font-semibold">{label}</p><p className="text-xs opacity-80">{count} lançamento{count === 1 ? "" : "s"}</p></div><strong className="font-display">{money.format(value)}</strong></div>;
}

function ReportEmpty({ text }: { text: string }) {
  return <p className="mt-4 rounded-2xl bg-glass-strong p-4 text-center text-xs text-muted-foreground">{text}</p>;
}

function BudgetMetric({ label, value, helper, tone, icon }: { label: string; value: number; helper: string; tone: "income" | "expense" | "primary"; icon: ReactNode }) {
  const toneClass = tone === "income" ? "text-income bg-income/10" : tone === "expense" ? "text-expense bg-expense/10" : "text-primary bg-primary/10";
  return <article className="rounded-2xl border border-glass-border bg-white/45 p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><span className={`grid size-8 place-items-center rounded-lg ${toneClass}`}>{icon}</span></div><p className={`mt-3 font-display text-2xl font-bold ${tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-foreground"}`}>{money.format(value)}</p><p className="mt-1 text-xs text-muted-foreground">{helper}</p></article>;
}

function BudgetTableCard({ title, subtitle, action, children, className = "" }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <article className={`overflow-hidden rounded-3xl border border-glass-border bg-glass shadow-glass backdrop-blur-xl ${className}`}><div className="flex items-center justify-between gap-3 px-5 py-4"><div><h2 className="font-display text-xl font-bold">{title}</h2><p className="text-xs text-muted-foreground">{subtitle}</p></div>{action}</div>{children}</article>;
}

function StatusBadge({ ok, okText, pendingText }: { ok: boolean; okText: string; pendingText: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${ok ? "bg-income/10 text-income" : "bg-warning/15 text-amber-700"}`}>{ok ? okText : pendingText}</span>;
}

function PriorityBadge({ value }: { value: string }) {
  const className = value === "ESSENCIAL" ? "bg-primary/10 text-primary" : value === "NÃO ESSENCIAL" ? "bg-muted text-muted-foreground" : "bg-warning/15 text-amber-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${className}`}>{value}</span>;
}

function ControlRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 rounded-xl bg-white/45 px-3 py-2.5"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{value}</span></div>;
}

function Logo() { return <span className="grid size-11 place-items-center rounded-2xl bg-hero font-display text-lg font-bold text-primary-foreground shadow-brand">E</span>; }
function Metric({ label, value, tone }: { label: string; value: number; tone: "income" | "expense" }) { return <div className="rounded-2xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-display text-base font-bold ${tone === 'income' ? 'text-income' : 'text-expense'}`}>{money.format(value)}</p></div>; }
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="grid place-items-center py-12 text-center"><WalletCards className="mb-3 size-9 text-primary"/><p className="font-semibold">Seu mês começa aqui</p><p className="mb-4 text-sm text-muted-foreground">Cadastre uma entrada ou despesa para visualizar seus relatórios.</p><Button variant="hero" className="rounded-xl" onClick={onAdd}><Plus />Novo lançamento</Button></div>; }

function AuthScreen({ mode, setMode, email, setEmail, password, setPassword, error, onSubmit }: { mode: "login" | "signup"; setMode: (v: "login" | "signup") => void; email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; error: string; onSubmit: (e: FormEvent) => void }) {
  async function google() { await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }); }
  return <main className="grid min-h-screen place-items-center px-4"><section className="w-full max-w-md rounded-3xl border border-glass-border bg-glass p-7 shadow-glass backdrop-blur-xl"><div className="mb-7 flex items-center gap-3"><Logo/><div><h1 className="font-display text-2xl font-bold">ESF</h1><p className="text-sm text-muted-foreground">Seu dinheiro com mais clareza.</p></div></div><div className="mb-5 grid grid-cols-2 rounded-xl bg-glass p-1"><button className={`rounded-lg py-2 text-sm font-semibold ${mode === 'login' ? 'bg-glass-strong shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('login')}>Entrar</button><button className={`rounded-lg py-2 text-sm font-semibold ${mode === 'signup' ? 'bg-glass-strong shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signup')}>Criar conta</button></div><form className="space-y-3" onSubmit={onSubmit}><Input type="email" required placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl bg-glass-strong"/><Input type="password" required minLength={6} placeholder="Sua senha" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl bg-glass-strong"/><Button variant="hero" className="h-12 w-full rounded-xl text-base font-bold text-secondary-foreground shadow-brand ring-1 ring-foreground/10">{mode === 'login' ? 'Entrar no ESF' : 'Criar minha conta'}</Button></form><div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/>ou<span className="h-px flex-1 bg-border"/></div><Button variant="glass" className="h-11 w-full rounded-xl" onClick={google}>Continuar com Google</Button>{error && <p className="mt-4 rounded-xl bg-expense/10 p-3 text-sm text-expense">{error}</p>}</section></main>;
}

function TransactionDialog({ open, setOpen, initialKind, categories, onSave }: { open: boolean; setOpen: (v: boolean) => void; initialKind: NewEntryKind; categories: Category[]; onSave: (e: FormEvent<HTMLFormElement>, purchases: DraftPurchase[]) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [isCardInvoice, setIsCardInvoice] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [reserveInvestment, setReserveInvestment] = useState(false);
  const [investmentPercent, setInvestmentPercent] = useState("10");
  const [investmentType, setInvestmentType] = useState<string>("Reserva de emergência");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Alimentação");
  const [customExpenseCategory, setCustomExpenseCategory] = useState("");
  const [purchases, setPurchases] = useState<DraftPurchase[]>([]);
  const purchaseTotal = purchases.reduce((sum, purchase) => sum + (Number(purchase.amount) || 0), 0);
  const difference = (Number(invoiceAmount) || 0) - purchaseTotal;
  const investmentPercentNumber = Math.min(100, Math.max(0, Number(investmentPercent) || 0));
  const investmentReserveAmount = reserveInvestment && type === "income" ? (Number(incomeAmount) || 0) * (investmentPercentNumber / 100) : 0;
  const incomeAvailable = Math.max(0, (Number(incomeAmount) || 0) - investmentReserveAmount);
  const expenseCategoryOptions = Array.from(new Set([
    ...DEFAULT_EXPENSE_CATEGORIES,
    ...categories.filter((category) => category.type === "expense").map((category) => category.name),
  ])).sort((a, b) => a.localeCompare(b, "pt-BR"));

  useEffect(() => {
    if (!open) return;
    const card = initialKind === "card";
    setType(initialKind === "income" ? "income" : "expense");
    setIsCardInvoice(card);
    setExpenseCategory(card ? "Cartão de crédito" : "Alimentação");
    setCustomExpenseCategory("");
  }, [open, initialKind]);

  function close(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) { setType("expense"); setIsCardInvoice(false); setInvoiceAmount(""); setReserveInvestment(false); setInvestmentPercent("10"); setInvestmentType("Reserva de emergência"); setIncomeAmount(""); setExpenseCategory("Alimentação"); setCustomExpenseCategory(""); setPurchases([]); }
  }

  function changeType(nextType: "expense" | "income") {
    setType(nextType);
    if (nextType === "income") { setIsCardInvoice(false); setInvoiceAmount(""); setPurchases([]); setExpenseCategory("Alimentação"); setCustomExpenseCategory(""); } else { setReserveInvestment(false); setIncomeAmount(""); }
  }

  function addPurchase() {
    setPurchases((current) => [...current, { id: crypto.randomUUID(), description: "", amount: "", purchaseDate: today }]);
  }

  return <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-blue-200 bg-gradient-to-br from-sky-100 via-blue-50 to-cyan-100 text-slate-900 shadow-brand backdrop-blur-xl [&_input]:bg-white [&_select]:bg-white sm:max-w-2xl"><DialogHeader><DialogTitle className="font-display text-2xl text-slate-900">Novo lançamento</DialogTitle><DialogDescription>Registre uma entrada ou despesa.</DialogDescription></DialogHeader><form onSubmit={(event) => onSave(event, purchases)} className="grid gap-4"><input type="hidden" name="type" value={isCardInvoice ? "card" : type}/><label className="grid gap-1.5 text-sm font-medium">Tipo<select value={type} onChange={(event) => changeType(event.target.value as "expense" | "income")} className="h-10 rounded-xl border border-input bg-background px-3"><option value="expense">Despesa</option><option value="income">Entrada</option></select></label>{type === "expense" && <label className="flex items-center gap-3 rounded-xl border border-glass-border bg-glass p-3 text-sm font-medium"><input type="checkbox" checked={isCardInvoice} onChange={(event) => { const checked = event.target.checked; setIsCardInvoice(checked); setExpenseCategory(checked ? "Cartão de crédito" : "Alimentação"); setCustomExpenseCategory(""); }} className="size-4 accent-primary"/>Esta despesa é uma fatura de cartão</label>}{isCardInvoice ? <><label className="grid gap-1.5 text-sm font-medium">Cartão<Input name="cardName" required maxLength={60} placeholder="Ex.: Nubank final 1234" className="h-10 rounded-xl"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">Total da fatura <span className="text-[11px] font-normal text-muted-foreground">(calculado pelas compras)</span><Input name="amount" value={invoiceAmount} readOnly required type="number" min="0.01" step="0.01" placeholder="Adicione as compras" className="h-10 rounded-xl bg-glass"/></label><label className="grid gap-1.5 text-sm font-medium">Vencimento<Input name="date" required type="date" defaultValue={today} className="h-10 rounded-xl"/></label></div><input type="hidden" name="description" value="Fatura de cartão"/><div className="rounded-2xl border border-glass-border bg-glass p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Compras da fatura</p><p className="text-xs text-muted-foreground">Detalhe cada gasto cobrado no cartão.</p></div><Button type="button" variant="glass" size="sm" className="rounded-xl" onClick={addPurchase}><Plus/>Compra</Button></div><div className="mt-4 grid gap-3">{purchases.length === 0 && <p className="rounded-xl bg-glass-strong p-4 text-center text-sm text-muted-foreground">Nenhuma compra adicionada.</p>}{purchases.map((purchase, index) => <div key={purchase.id} className="grid gap-2 rounded-xl border border-glass-border p-3 sm:grid-cols-[1fr_130px_145px_36px]"><Input aria-label={`Descrição da compra ${index + 1}`} value={purchase.description} onChange={(event) => setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, description: event.target.value } : item))} required placeholder="Descrição" className="h-9 rounded-lg"/><Input aria-label={`Valor da compra ${index + 1}`} value={purchase.amount} onChange={(event) => setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, amount: event.target.value } : item))} required type="number" min="0.01" step="0.01" placeholder="Valor" className="h-9 rounded-lg"/><Input aria-label={`Data da compra ${index + 1}`} value={purchase.purchaseDate} onChange={(event) => setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, purchaseDate: event.target.value } : item))} required type="date" className="h-9 rounded-lg"/><Button type="button" variant="ghost" size="icon" className="size-9 text-expense" aria-label={`Remover compra ${index + 1}`} onClick={() => setPurchases((current) => current.filter((item) => item.id !== purchase.id))}><Trash2/></Button></div>)}</div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">Soma das compras</p><p className="font-display text-lg font-bold">{money.format(purchaseTotal)}</p></div><div className={`rounded-xl p-3 ${Math.abs(difference) < 0.005 && Number(invoiceAmount) > 0 ? 'bg-income/10 text-income' : 'bg-warning/15'}`}><p className="text-xs">{Math.abs(difference) < 0.005 && Number(invoiceAmount) > 0 ? 'Fatura conferida' : 'Diferença'}</p><p className="font-display text-lg font-bold">{money.format(Math.abs(difference))}</p></div></div></div></> : <><label className="grid gap-1.5 text-sm font-medium">Descrição<Input name="description" required maxLength={120} placeholder={type === "income" ? "Ex.: Salário" : "Ex.: Supermercado"} className="h-10 rounded-xl"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">Valor<Input name="amount" required type="number" min="0.01" step="0.01" placeholder="0,00" value={type === "income" ? incomeAmount : undefined} onChange={type === "income" ? (event) => setIncomeAmount(event.target.value) : undefined} className="h-10 rounded-xl"/></label><label className="grid gap-1.5 text-sm font-medium">Data<Input name="date" required type="date" defaultValue={today} className="h-10 rounded-xl"/></label></div>{type === "income" && <div className="rounded-2xl border border-glass-border bg-glass p-4"><label className="flex items-center gap-3 text-sm font-semibold"><input name="reserveInvestment" type="checkbox" checked={reserveInvestment} onChange={(event) => setReserveInvestment(event.target.checked)} className="size-4 accent-primary"/>Separar parte desta entrada para investimentos</label>{reserveInvestment && <div className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr_1fr]"><label className="grid gap-1.5 text-sm font-medium sm:col-span-3">Investimento<select name="investmentType" required value={investmentType} onChange={(event) => setInvestmentType(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3">{INVESTMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">Percentual (%)<Input name="investmentPercent" value={investmentPercent} onChange={(event) => setInvestmentPercent(event.target.value)} required type="number" min="0.01" max="100" step="0.01" className="h-10 rounded-xl"/></label><div className="rounded-xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">Reserva</p><p className="font-display text-lg font-bold text-primary">{money.format(investmentReserveAmount)}</p></div><div className="rounded-xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">Disponível</p><p className="font-display text-lg font-bold text-income">{money.format(incomeAvailable)}</p></div></div>}<p className="mt-2 text-[11px] text-muted-foreground">Escolha o percentual e o destino da reserva. Ao salvar, ela será registrada na categoria Investimentos com o destino selecionado.</p></div>}</>}{type === "expense" ? <div className="grid gap-2"><label className="grid gap-1.5 text-sm font-medium">Categoria<select value={expenseCategory} onChange={(event) => { setExpenseCategory(event.target.value); if (event.target.value !== "__new__") setCustomExpenseCategory(""); }} className="h-10 rounded-xl border border-input bg-background px-3"><option value="" disabled>Selecione uma categoria</option>{expenseCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}<option value="__new__">+ Cadastrar nova categoria</option></select></label>{expenseCategory === "__new__" ? <label className="grid gap-1.5 text-sm font-medium">Nova categoria<Input name="category" required maxLength={60} value={customExpenseCategory} onChange={(event) => setCustomExpenseCategory(event.target.value)} placeholder="Digite o nome da categoria" className="h-10 rounded-xl"/></label> : <input type="hidden" name="category" value={expenseCategory}/>}</div> : <label className="grid gap-1.5 text-sm font-medium">Categoria<Input name="category" required maxLength={60} placeholder="Ex.: Trabalho" className="h-10 rounded-xl"/></label>}<Button variant="hero" className="mt-2 h-11 rounded-xl text-blue-950"><Plus />Salvar lançamento</Button></form></DialogContent></Dialog>;
}

function EditTransactionDialog({ transaction, category, onClose, onSave, onDelete }: { transaction: Tx | null; category: string; onClose: () => void; onSave: (e: FormEvent<HTMLFormElement>) => void; onDelete: () => void }) {
  return <Dialog open={Boolean(transaction)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="rounded-3xl border-glass-border bg-glass-strong backdrop-blur-xl sm:max-w-lg"><DialogHeader><DialogTitle className="font-display text-2xl">Editar lançamento</DialogTitle><DialogDescription>Corrija os dados e salve para atualizar seus relatórios.</DialogDescription></DialogHeader>{transaction && <form key={transaction.id} onSubmit={onSave} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Tipo<Input value={transaction.is_card_invoice ? "Fatura de cartão" : transaction.type === "income" ? "Entrada" : "Despesa"} disabled className="h-10 rounded-xl bg-glass"/></label>{transaction.is_card_invoice ? <label className="grid gap-1.5 text-sm font-medium">Cartão<Input name="cardName" required maxLength={60} defaultValue={transaction.card_name ?? ""} className="h-10 rounded-xl"/></label> : <label className="grid gap-1.5 text-sm font-medium">Descrição<Input name="description" required maxLength={120} defaultValue={transaction.description} className="h-10 rounded-xl"/></label>}<div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">{transaction.is_card_invoice ? "Total da fatura" : "Valor"}<Input name="amount" required type="number" min="0.01" step="0.01" defaultValue={String(transaction.amount)} readOnly={transaction.is_card_invoice} className={`h-10 rounded-xl ${transaction.is_card_invoice ? "bg-glass" : ""}`}/>{transaction.is_card_invoice && <span className="text-[11px] font-normal text-muted-foreground">O total é recalculado pelas compras da fatura.</span>}</label><label className="grid gap-1.5 text-sm font-medium">Data<Input name="date" required type="date" defaultValue={transaction.transaction_date} className="h-10 rounded-xl"/></label></div><label className="grid gap-1.5 text-sm font-medium">Categoria<Input name="category" required maxLength={60} defaultValue={category} placeholder="Ex.: Moradia" className="h-10 rounded-xl"/></label><label className="grid gap-1.5 text-sm font-medium">Status<select name="reconciled" defaultValue={transaction.reconciled ? "true" : "false"} className="h-10 rounded-xl border border-input bg-background px-3"><option value="true">{transaction.type === "income" ? "Confirmado" : "Pago"}</option><option value="false">{transaction.type === "income" ? "Previsto" : "Em aberto"}</option></select></label><div className="mt-2 grid grid-cols-2 gap-3"><Button type="button" variant="ghost" className="h-11 rounded-xl text-expense" onClick={onDelete}><Trash2 />Excluir lançamento</Button><Button variant="hero" className="h-11 rounded-xl"><Pencil />Salvar alterações</Button></div></form>}</DialogContent></Dialog>;
}

function InvoiceDetailDialog({ invoice, purchases, onClose, onSavePurchase, onDeletePurchase }: { invoice: Tx | null; purchases: CardPurchase[]; onClose: () => void; onSavePurchase: (e: FormEvent<HTMLFormElement>, purchase: CardPurchase) => void; onDeletePurchase: (purchase: CardPurchase) => void }) {
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const total = purchases.reduce((sum, purchase) => sum + Number(purchase.amount), 0);
  const difference = Number(invoice?.amount ?? 0) - total;

  function close(open: boolean) {
    if (!open) { setEditingPurchaseId(null); onClose(); }
  }

  return <Dialog open={Boolean(invoice)} onOpenChange={close}><DialogContent className="max-h-[88vh] overflow-y-auto rounded-3xl border-glass-border bg-glass-strong backdrop-blur-xl sm:max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2 font-display text-2xl"><CreditCard className="text-primary"/>{invoice?.card_name}</DialogTitle><DialogDescription>Compras incluídas em {invoice?.description.toLowerCase()}. Você pode editar ou remover cada lançamento.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-glass p-3"><p className="text-xs text-muted-foreground">Valor da fatura</p><p className="font-display text-lg font-bold">{money.format(Number(invoice?.amount ?? 0))}</p></div><div className={`rounded-xl p-3 ${Math.abs(difference) < 0.005 ? 'bg-income/10 text-income' : 'bg-warning/15'}`}><p className="text-xs">{Math.abs(difference) < 0.005 ? 'Fatura conferida' : 'Diferença'}</p><p className="font-display text-lg font-bold">{money.format(Math.abs(difference))}</p></div></div><div className="divide-y divide-border">{purchases.map((purchase) => editingPurchaseId === purchase.id ? <form key={purchase.id} onSubmit={(event) => { onSavePurchase(event, purchase); setEditingPurchaseId(null); }} className="grid gap-2 py-3 sm:grid-cols-[1fr_110px_140px_auto]"><Input name="description" required maxLength={120} defaultValue={purchase.description} aria-label="Descrição da compra" className="h-9 rounded-lg"/><Input name="amount" required type="number" min="0.01" step="0.01" defaultValue={String(purchase.amount)} aria-label="Valor da compra" className="h-9 rounded-lg"/><Input name="purchaseDate" required type="date" defaultValue={purchase.purchase_date} aria-label="Data da compra" className="h-9 rounded-lg"/><div className="flex gap-1"><Button type="submit" variant="hero" size="icon" className="size-9" aria-label="Salvar compra"><Check className="size-4"/></Button><Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Cancelar edição" onClick={() => setEditingPurchaseId(null)}><X className="size-4"/></Button></div></form> : <div key={purchase.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{purchase.description}</p><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat('pt-BR').format(new Date(`${purchase.purchase_date}T12:00:00`))}</p></div><p className="font-display text-sm font-bold">{money.format(Number(purchase.amount))}</p><div className="flex gap-1"><Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Editar ${purchase.description}`} onClick={() => setEditingPurchaseId(purchase.id)}><Pencil className="size-4"/></Button><Button type="button" variant="ghost" size="icon" className="size-8 text-expense" aria-label={`Remover ${purchase.description}`} onClick={() => onDeletePurchase(purchase)}><Trash2 className="size-4"/></Button></div></div>)}</div>{purchases.length === 0 && <p className="rounded-xl bg-glass p-4 text-center text-sm text-muted-foreground">Nenhuma compra cadastrada nesta fatura.</p>}<div className="flex items-center justify-between border-t border-border pt-4"><p className="font-semibold">Soma das compras</p><p className="font-display text-xl font-bold">{money.format(total)}</p></div></DialogContent></Dialog>;
}
