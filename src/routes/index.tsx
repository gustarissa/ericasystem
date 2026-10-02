import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, CreditCard, LoaderCircle, LogOut, Menu, Pencil, Plus, ReceiptText, Sparkles, Trash2, WalletCards, X } from "lucide-react";

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

  async function handleAuth(event: FormEvent) {
    event.preventDefault(); setAuthError("");
    const result = authMode === "login" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    if (result.error) setAuthError(result.error.message);
    else if (authMode === "signup" && !result.data.session) setAuthError("Confira seu e-mail para confirmar o cadastro.");
  }

  if (loading) return <div className="grid min-h-screen place-items-center"><LoaderCircle className="size-7 animate-spin text-primary" /></div>;
  if (!userId) return <AuthScreen mode={authMode} setMode={setAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} error={authError} onSubmit={handleAuth} />;
  const currentUserId = userId;

  async function saveTransaction(event: FormEvent<HTMLFormElement>, purchases: DraftPurchase[]) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedType = String(form.get("type"));
    const isCardInvoice = selectedType === "card";
    const type = (isCardInvoice ? "expense" : selectedType) as "income" | "expense";
    const categoryName = String(form.get("category")).trim();
    let category = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase() && c.type === type);
    if (!category) {
      const { data, error } = await supabase.from("categories").insert({ user_id: currentUserId, name: categoryName, type, color: type === "income" ? "green" : "blue", icon: "tag" }).select("id,name,type,color,icon").single();
      if (error || !data) { setNotice(error?.message ?? "Não foi possível criar a categoria."); return; }
      category = data as Category;
    }
    const invoiceAmount = Number(form.get("amount"));
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
    setDialogOpen(false); setNotice(isCardInvoice ? "Fatura e compras adicionadas." : "Lançamento adicionado."); await loadData(currentUserId);
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
    let category = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase() && c.type === type);
    if (!category) {
      const { data, error } = await supabase.from("categories").insert({ user_id: currentUserId, name: categoryName, type, color: type === "income" ? "green" : "blue", icon: "tag" }).select("id,name,type,color,icon").single();
      if (error || !data) { setNotice(error?.message ?? "Não foi possível criar a categoria."); return; }
      category = data as Category;
    }
    const cardName = editingTransaction.is_card_invoice ? String(form.get("cardName")).trim() : null;
    const { error } = await supabase.from("transactions").update({
      category_id: category.id,
      description: editingTransaction.is_card_invoice ? `Fatura ${cardName}` : String(form.get("description")).trim(),
      amount: editingTransaction.is_card_invoice ? editingTransaction.amount : Number(form.get("amount")),
      transaction_date: String(form.get("date")),
      card_name: cardName,
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
    try { const result = await runInsight({ data: { income, expenses, balance, topCategory: topCategory?.name ?? "Sem despesas", topCategoryAmount: topCategory?.total ?? 0 } }); setInsight(result.text); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível gerar a análise."); }
    finally { setInsightLoading(false); }
  }

  return (
    <main className="min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="sticky top-4 z-30 flex items-center justify-between rounded-3xl border border-glass-border bg-glass px-4 py-3 shadow-glass backdrop-blur-xl sm:px-6">
          <a href="#resumo" className="flex items-center gap-3"><Logo /><div><p className="font-display text-xl font-bold leading-none">ESF</p><p className="mt-1 text-[10px] font-semibold uppercase text-muted-foreground">Controle financeiro</p></div></a>
          <nav className="hidden items-center gap-1 rounded-2xl border border-glass-border bg-glass p-1 text-sm font-medium md:flex">
            {[['resumo','Visão geral'],['movimentos','Movimentos'],['relatorios','Relatórios'],['conciliacao','Conferir pagamentos'],['ia','Insights IA']].map(([id,label]) => <a key={id} href={`#${id}`} className="rounded-xl px-3 py-2 text-muted-foreground transition hover:bg-glass-strong hover:text-foreground">{label}</a>)}
          </nav>
          <div className="flex gap-2"><Button variant="glass" className="hidden rounded-xl sm:inline-flex" onClick={() => openNewEntry("expense")}><Plus />Novo lançamento</Button><Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</Button><Button variant="ghost" size="icon" aria-label="Sair" onClick={() => supabase.auth.signOut()}><LogOut /></Button></div>
          {mobileMenu && <nav className="absolute left-4 right-4 top-[76px] grid gap-1 rounded-2xl border border-glass-border bg-glass-strong p-2 shadow-glass backdrop-blur-xl md:hidden">{[['resumo','Visão geral'],['movimentos','Movimentos'],['relatorios','Relatórios'],['conciliacao','Conferir pagamentos'],['ia','Insights IA']].map(([id,label]) => <a key={id} href={`#${id}`} onClick={() => setMobileMenu(false)} className="rounded-xl px-4 py-3 text-sm font-medium">{label}</a>)}</nav>}
        </header>

        <section id="resumo" className="scroll-mt-28 pt-6">
          <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Sua vida financeira, em ordem</p><h1 className="font-display text-3xl font-bold sm:text-4xl">Visão geral</h1></div><div className="flex items-center gap-1 rounded-xl border border-glass-border bg-glass p-1"><Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button><span className="min-w-28 text-center text-sm font-semibold capitalize">{monthLabel.format(month)}</span><Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button></div></div>
          <div className="grid gap-5 lg:grid-cols-3">
            <article className="animate-rise rounded-3xl border border-glass-border bg-glass p-6 shadow-glass backdrop-blur-xl">
              <div className="flex justify-between"><span className="text-sm font-medium text-muted-foreground">Saldo do mês</span><WalletCards className="text-primary" /></div><p className="mt-2 font-display text-4xl font-bold">{money.format(balance)}</p>
              <div className="mt-5 grid grid-cols-2 gap-3"><Metric label="Recebido" value={income} tone="income" /><Metric label="Gasto" value={expenses} tone="expense" /></div>
              <div className="mt-5 h-36"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--income)" stopOpacity={0.4}/><stop offset="95%" stopColor="var(--income)" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11}/><Tooltip formatter={(v) => money.format(Number(v))}/><Area type="monotone" dataKey="entradas" stroke="var(--income)" fill="url(#incomeFill)" strokeWidth={3}/><Area type="monotone" dataKey="despesas" stroke="var(--expense)" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>
            </article>
            <article id="relatorios" className="animate-rise scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-6 shadow-glass backdrop-blur-xl [animation-delay:80ms]"><div className="flex justify-between"><span className="text-sm font-medium text-muted-foreground">Categoria com maior gasto</span><span className="rounded-full bg-expense/10 px-2.5 py-1 text-xs font-semibold text-expense">{expenses ? Math.round(((topCategory?.total ?? 0) / expenses) * 100) : 0}%</span></div><p className="mt-2 font-display text-2xl font-bold">{topCategory?.name ?? "Sem despesas"}</p><p className="font-display text-lg font-semibold text-muted-foreground">{money.format(topCategory?.total ?? 0)}</p><div className="mt-5 space-y-4">{categoryTotals.slice(0,4).map((c) => <div key={c.id}><div className="flex justify-between text-xs font-medium"><span>{c.name}</span><span className="text-muted-foreground">{money.format(c.total)}</span></div><div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-glass-strong"><div className="h-full rounded-full bg-hero" style={{ width: `${Math.max(8, (c.total / (topCategory?.total || 1)) * 100)}%` }} /></div></div>)}</div></article>
            <article id="ia" className="animate-rise scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-6 shadow-glass backdrop-blur-xl [animation-delay:160ms]"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-xl bg-hero text-primary-foreground"><Sparkles /></span><p className="font-display text-sm font-bold uppercase text-primary">Insights IA</p></div><div className="mt-4 min-h-44 rounded-2xl bg-glass-strong p-4"><p className="text-sm font-semibold">Seu plano financeiro</p>{insight ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{insight}</p> : <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Analiso seu saldo, despesas e categorias para sugerir ajustes, reserva e caminhos de investimento compatíveis com o mês.</p>}</div><Button variant="hero" className="mt-4 w-full rounded-xl" onClick={askAI} disabled={insightLoading}>{insightLoading ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Gerar plano personalizado</Button><p className="mt-3 text-[10px] text-muted-foreground">Sugestões educativas. Investimentos envolvem riscos.</p></article>
          </div>
        </section>

        <section id="movimentos" className="mt-6 scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-4 shadow-glass backdrop-blur-xl sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="font-display text-xl font-bold">Movimentos</h2><p className="text-xs text-muted-foreground">Encontre, confira e edite entradas, despesas e faturas.</p></div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="glass" className="rounded-xl" onClick={() => openNewEntry("income")}><ArrowUp />Receita</Button>
              <Button variant="glass" className="rounded-xl" onClick={() => openNewEntry("expense")}><ArrowDown />Despesa</Button>
              <Button variant="glass" className="rounded-xl" onClick={() => openNewEntry("card")}><CreditCard />Fatura</Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Buscar por nome, cartão ou categoria..." className="h-11 rounded-xl bg-glass-strong"/>
            <div className="flex flex-wrap gap-2">
              {([["all","Todos"],["income","Receitas"],["expense","Despesas"],["card","Faturas"]] as const).map(([value,label]) => <Button key={value} type="button" variant={transactionFilter === value ? "hero" : "glass"} size="sm" className="rounded-xl" onClick={() => setTransactionFilter(value)}>{label}</Button>)}
            </div>
          </div>
          <div className="mt-5 divide-y divide-border">
            {visibleTransactions.length ? visibleTransactions.map((t) => {
              const cat = categories.find((item) => item.id === t.category_id);
              const purchaseCount = t.is_card_invoice ? cardPurchases.filter((purchase) => purchase.transaction_id === t.id).length : 0;
              return <div key={t.id} className="grid gap-3 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                <span className={`grid size-10 place-items-center rounded-xl ${t.type === 'income' ? 'bg-income/10 text-income' : 'bg-expense/10 text-expense'}`}>{t.is_card_invoice ? <CreditCard /> : t.type === 'income' ? <ArrowUp /> : <ArrowDown />}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.description}</p>
                  <p className="text-xs text-muted-foreground">{cat?.name ?? 'Sem categoria'} · {new Intl.DateTimeFormat('pt-BR').format(new Date(`${t.transaction_date}T12:00:00`))}</p>
                  {t.is_card_invoice && <Button type="button" variant="glass" size="sm" className="mt-2 h-8 rounded-lg text-xs" onClick={() => setInvoiceDetail(t)}><ReceiptText className="size-3.5"/>Ver compras ({purchaseCount})</Button>}
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className={`font-display text-sm font-bold ${t.type === 'income' ? 'text-income' : 'text-expense'}`}>{t.type === 'income' ? '+' : '-'} {money.format(Number(t.amount))}</span>
                  <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t.is_card_invoice ? `Editar fatura ${t.description}` : `Editar ${t.description}`} onClick={() => setEditingTransaction(t)}><Pencil className="size-4"/></Button>
                </div>
              </div>;
            }) : <div className="py-10 text-center"><p className="font-semibold">Nenhum lançamento encontrado</p><p className="mt-1 text-sm text-muted-foreground">Tente outro filtro ou termo de busca.</p></div>}
          </div>
          {filteredTransactions.length > 10 && !transactionSearch.trim() && transactionFilter === "all" && <div className="mt-4 flex justify-center"><Button type="button" variant="glass" className="rounded-xl" onClick={() => setShowAllTransactions((current) => !current)}>{showAllTransactions ? "Mostrar menos" : `Ver todos (${filteredTransactions.length})`}</Button></div>}
        </section>

        <section id="conciliacao" className="my-6 scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-4 shadow-glass backdrop-blur-xl sm:p-6"><div className="flex items-center justify-between"><div><h2 className="font-display text-xl font-bold">Conferir pagamentos</h2><p className="text-xs text-muted-foreground">Marque o que você já confirmou no extrato ou na fatura.</p></div><span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold">{monthTransactions.filter((t) => !t.reconciled).length} pendentes</span></div><div className="mt-4 grid gap-3 md:grid-cols-2">{monthTransactions.filter((t) => !t.reconciled).map((t) => <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-glass-strong p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{t.description}</p><p className="text-xs text-muted-foreground">{money.format(Number(t.amount))}</p></div><Button variant="glass" size="sm" className="rounded-xl" onClick={() => reconcile(t.id)}><Check />Conferir</Button></div>)}</div></section>
      </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-brand">{notice}<button className="ml-4" onClick={() => setNotice("")} aria-label="Fechar aviso">×</button></div>}
      <TransactionDialog open={dialogOpen} setOpen={setDialogOpen} initialKind={newEntryKind} onSave={saveTransaction} />
      <EditTransactionDialog transaction={editingTransaction} category={categories.find((c) => c.id === editingTransaction?.category_id)?.name ?? ""} onClose={() => setEditingTransaction(null)} onSave={updateTransaction} onDelete={() => editingTransaction && deleteTransaction(editingTransaction)} />
      <InvoiceDetailDialog invoice={invoiceDetail} purchases={cardPurchases.filter((purchase) => purchase.transaction_id === invoiceDetail?.id)} onClose={() => setInvoiceDetail(null)} onSavePurchase={updateCardPurchase} onDeletePurchase={deleteCardPurchase} />
    </main>
  );
}

function Logo() { return <span className="grid size-11 place-items-center rounded-2xl bg-hero font-display text-lg font-bold text-primary-foreground shadow-brand">E</span>; }
function Metric({ label, value, tone }: { label: string; value: number; tone: "income" | "expense" }) { return <div className="rounded-2xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-display text-base font-bold ${tone === 'income' ? 'text-income' : 'text-expense'}`}>{money.format(value)}</p></div>; }
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="grid place-items-center py-12 text-center"><WalletCards className="mb-3 size-9 text-primary"/><p className="font-semibold">Seu mês começa aqui</p><p className="mb-4 text-sm text-muted-foreground">Cadastre uma entrada ou despesa para visualizar seus relatórios.</p><Button variant="hero" className="rounded-xl" onClick={onAdd}><Plus />Novo lançamento</Button></div>; }

function AuthScreen({ mode, setMode, email, setEmail, password, setPassword, error, onSubmit }: { mode: "login" | "signup"; setMode: (v: "login" | "signup") => void; email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; error: string; onSubmit: (e: FormEvent) => void }) {
  async function google() { await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }); }
  return <main className="grid min-h-screen place-items-center px-4"><section className="w-full max-w-md rounded-3xl border border-glass-border bg-glass p-7 shadow-glass backdrop-blur-xl"><div className="mb-7 flex items-center gap-3"><Logo/><div><h1 className="font-display text-2xl font-bold">ESF</h1><p className="text-sm text-muted-foreground">Seu dinheiro com mais clareza.</p></div></div><div className="mb-5 grid grid-cols-2 rounded-xl bg-glass p-1"><button className={`rounded-lg py-2 text-sm font-semibold ${mode === 'login' ? 'bg-glass-strong shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('login')}>Entrar</button><button className={`rounded-lg py-2 text-sm font-semibold ${mode === 'signup' ? 'bg-glass-strong shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signup')}>Criar conta</button></div><form className="space-y-3" onSubmit={onSubmit}><Input type="email" required placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl bg-glass-strong"/><Input type="password" required minLength={6} placeholder="Sua senha" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl bg-glass-strong"/><Button variant="hero" className="h-12 w-full rounded-xl text-base font-bold text-secondary-foreground shadow-brand ring-1 ring-foreground/10">{mode === 'login' ? 'Entrar no ESF' : 'Criar minha conta'}</Button></form><div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/>ou<span className="h-px flex-1 bg-border"/></div><Button variant="glass" className="h-11 w-full rounded-xl" onClick={google}>Continuar com Google</Button>{error && <p className="mt-4 rounded-xl bg-expense/10 p-3 text-sm text-expense">{error}</p>}</section></main>;
}

function TransactionDialog({ open, setOpen, initialKind, onSave }: { open: boolean; setOpen: (v: boolean) => void; initialKind: NewEntryKind; onSave: (e: FormEvent<HTMLFormElement>, purchases: DraftPurchase[]) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [isCardInvoice, setIsCardInvoice] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [purchases, setPurchases] = useState<DraftPurchase[]>([]);
  const purchaseTotal = purchases.reduce((sum, purchase) => sum + (Number(purchase.amount) || 0), 0);
  const difference = (Number(invoiceAmount) || 0) - purchaseTotal;

  function close(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) { setType("expense"); setIsCardInvoice(false); setInvoiceAmount(""); setPurchases([]); }
  }

  function changeType(nextType: "expense" | "income") {
    setType(nextType);
    if (nextType === "income") { setIsCardInvoice(false); setInvoiceAmount(""); setPurchases([]); }
  }

  function addPurchase() {
    setPurchases((current) => [...current, { id: crypto.randomUUID(), description: "", amount: "", purchaseDate: today }]);
  }

  return <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-blue-200 bg-gradient-to-br from-sky-100 via-blue-50 to-cyan-100 text-slate-900 shadow-brand backdrop-blur-xl [&_input]:bg-white [&_select]:bg-white sm:max-w-2xl"><DialogHeader><DialogTitle className="font-display text-2xl text-slate-900">Novo lançamento</DialogTitle><DialogDescription>Registre uma entrada ou despesa.</DialogDescription></DialogHeader><form onSubmit={(event) => onSave(event, purchases)} className="grid gap-4"><input type="hidden" name="type" value={isCardInvoice ? "card" : type}/><label className="grid gap-1.5 text-sm font-medium">Tipo<select value={type} onChange={(event) => changeType(event.target.value as "expense" | "income")} className="h-10 rounded-xl border border-input bg-background px-3"><option value="expense">Despesa</option><option value="income">Entrada</option></select></label>{type === "expense" && <label className="flex items-center gap-3 rounded-xl border border-glass-border bg-glass p-3 text-sm font-medium"><input type="checkbox" checked={isCardInvoice} onChange={(event) => setIsCardInvoice(event.target.checked)} className="size-4 accent-primary"/>Esta despesa é uma fatura de cartão</label>}{isCardInvoice ? <><label className="grid gap-1.5 text-sm font-medium">Cartão<Input name="cardName" required maxLength={60} placeholder="Ex.: Nubank final 1234" className="h-10 rounded-xl"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">Total da fatura <span className="text-[11px] font-normal text-muted-foreground">(calculado pelas compras)</span><Input name="amount" value={invoiceAmount} readOnly required type="number" min="0.01" step="0.01" placeholder="Adicione as compras" className="h-10 rounded-xl bg-glass"/></label><label className="grid gap-1.5 text-sm font-medium">Vencimento<Input name="date" required type="date" defaultValue={today} className="h-10 rounded-xl"/></label></div><input type="hidden" name="description" value="Fatura de cartão"/><div className="rounded-2xl border border-glass-border bg-glass p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Compras da fatura</p><p className="text-xs text-muted-foreground">Detalhe cada gasto cobrado no cartão.</p></div><Button type="button" variant="glass" size="sm" className="rounded-xl" onClick={addPurchase}><Plus/>Compra</Button></div><div className="mt-4 grid gap-3">{purchases.length === 0 && <p className="rounded-xl bg-glass-strong p-4 text-center text-sm text-muted-foreground">Nenhuma compra adicionada.</p>}{purchases.map((purchase, index) => <div key={purchase.id} className="grid gap-2 rounded-xl border border-glass-border p-3 sm:grid-cols-[1fr_130px_145px_36px]"><Input aria-label={`Descrição da compra ${index + 1}`} value={purchase.description} onChange={(event) => setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, description: event.target.value } : item))} required placeholder="Descrição" className="h-9 rounded-lg"/><Input aria-label={`Valor da compra ${index + 1}`} value={purchase.amount} onChange={(event) => setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, amount: event.target.value } : item))} required type="number" min="0.01" step="0.01" placeholder="Valor" className="h-9 rounded-lg"/><Input aria-label={`Data da compra ${index + 1}`} value={purchase.purchaseDate} onChange={(event) => setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, purchaseDate: event.target.value } : item))} required type="date" className="h-9 rounded-lg"/><Button type="button" variant="ghost" size="icon" className="size-9 text-expense" aria-label={`Remover compra ${index + 1}`} onClick={() => setPurchases((current) => current.filter((item) => item.id !== purchase.id))}><Trash2/></Button></div>)}</div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">Soma das compras</p><p className="font-display text-lg font-bold">{money.format(purchaseTotal)}</p></div><div className={`rounded-xl p-3 ${Math.abs(difference) < 0.005 && Number(invoiceAmount) > 0 ? 'bg-income/10 text-income' : 'bg-warning/15'}`}><p className="text-xs">{Math.abs(difference) < 0.005 && Number(invoiceAmount) > 0 ? 'Fatura conferida' : 'Diferença'}</p><p className="font-display text-lg font-bold">{money.format(Math.abs(difference))}</p></div></div></div></> : <><label className="grid gap-1.5 text-sm font-medium">Descrição<Input name="description" required maxLength={120} placeholder={type === "income" ? "Ex.: Salário" : "Ex.: Supermercado"} className="h-10 rounded-xl"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">Valor<Input name="amount" required type="number" min="0.01" step="0.01" placeholder="0,00" className="h-10 rounded-xl"/></label><label className="grid gap-1.5 text-sm font-medium">Data<Input name="date" required type="date" defaultValue={today} className="h-10 rounded-xl"/></label></div></>}<label className="grid gap-1.5 text-sm font-medium">Categoria<Input name="category" required maxLength={60} placeholder={isCardInvoice ? "Ex.: Cartão de crédito" : type === "income" ? "Ex.: Trabalho" : "Ex.: Moradia"} className="h-10 rounded-xl"/></label><Button variant="hero" className="mt-2 h-11 rounded-xl"><Plus />Salvar lançamento</Button></form></DialogContent></Dialog>;
}

function EditTransactionDialog({ transaction, category, onClose, onSave, onDelete }: { transaction: Tx | null; category: string; onClose: () => void; onSave: (e: FormEvent<HTMLFormElement>) => void; onDelete: () => void }) {
  return <Dialog open={Boolean(transaction)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="rounded-3xl border-glass-border bg-glass-strong backdrop-blur-xl sm:max-w-lg"><DialogHeader><DialogTitle className="font-display text-2xl">Editar lançamento</DialogTitle><DialogDescription>Corrija os dados e salve para atualizar seus relatórios.</DialogDescription></DialogHeader>{transaction && <form key={transaction.id} onSubmit={onSave} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Tipo<Input value={transaction.is_card_invoice ? "Fatura de cartão" : transaction.type === "income" ? "Entrada" : "Despesa"} disabled className="h-10 rounded-xl bg-glass"/></label>{transaction.is_card_invoice ? <label className="grid gap-1.5 text-sm font-medium">Cartão<Input name="cardName" required maxLength={60} defaultValue={transaction.card_name ?? ""} className="h-10 rounded-xl"/></label> : <label className="grid gap-1.5 text-sm font-medium">Descrição<Input name="description" required maxLength={120} defaultValue={transaction.description} className="h-10 rounded-xl"/></label>}<div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">{transaction.is_card_invoice ? "Total da fatura" : "Valor"}<Input name="amount" required type="number" min="0.01" step="0.01" defaultValue={String(transaction.amount)} readOnly={transaction.is_card_invoice} className={`h-10 rounded-xl ${transaction.is_card_invoice ? "bg-glass" : ""}`}/>{transaction.is_card_invoice && <span className="text-[11px] font-normal text-muted-foreground">O total é recalculado pelas compras da fatura.</span>}</label><label className="grid gap-1.5 text-sm font-medium">Data<Input name="date" required type="date" defaultValue={transaction.transaction_date} className="h-10 rounded-xl"/></label></div><label className="grid gap-1.5 text-sm font-medium">Categoria<Input name="category" required maxLength={60} defaultValue={category} placeholder="Ex.: Moradia" className="h-10 rounded-xl"/></label><div className="mt-2 grid grid-cols-2 gap-3"><Button type="button" variant="ghost" className="h-11 rounded-xl text-expense" onClick={onDelete}><Trash2 />Excluir lançamento</Button><Button variant="hero" className="h-11 rounded-xl"><Pencil />Salvar alterações</Button></div></form>}</DialogContent></Dialog>;
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
