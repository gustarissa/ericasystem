import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, LoaderCircle, LogOut, Menu, Plus, Sparkles, WalletCards, X } from "lucide-react";

import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { generateFinancialInsight } from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Tx = { id: string; description: string; amount: number; type: "income" | "expense"; transaction_date: string; reconciled: boolean; category_id: string | null };
type Category = { id: string; name: string; type: "income" | "expense"; color: string; icon: string };

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
  const [month, setMonth] = useState(() => new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const runInsight = useServerFn(generateFinancialInsight);

  async function loadData(id: string) {
    const [{ data: tx }, { data: cats }] = await Promise.all([
      supabase.from("transactions").select("id,description,amount,type,transaction_date,reconciled,category_id").eq("user_id", id).order("transaction_date", { ascending: false }),
      supabase.from("categories").select("id,name,type,color,icon").eq("user_id", id).order("name"),
    ]);
    setTransactions((tx ?? []) as Tx[]);
    setCategories((cats ?? []) as Category[]);
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
      if (id) void loadData(id); else { setTransactions([]); setCategories([]); }
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

  async function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get("type")) as "income" | "expense";
    const categoryName = String(form.get("category")).trim();
    let category = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase() && c.type === type);
    if (!category) {
      const { data, error } = await supabase.from("categories").insert({ user_id: userId, name: categoryName, type, color: type === "income" ? "green" : "blue", icon: "tag" }).select("id,name,type,color,icon").single();
      if (error || !data) { setNotice(error?.message ?? "Não foi possível criar a categoria."); return; }
      category = data as Category;
    }
    const { error } = await supabase.from("transactions").insert({ user_id: userId, category_id: category.id, description: String(form.get("description")), amount: Number(form.get("amount")), type, transaction_date: String(form.get("date")), reconciled: false });
    if (error) setNotice(error.message); else { setDialogOpen(false); setNotice("Lançamento adicionado."); await loadData(userId); }
  }

  async function reconcile(id: string) {
    const { error } = await supabase.from("transactions").update({ reconciled: true }).eq("id", id);
    if (error) setNotice(error.message); else { setNotice("Gasto conciliado."); await loadData(userId); }
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
            {[['resumo','Visão geral'],['movimentos','Movimentos'],['relatorios','Relatórios'],['conciliacao','Conciliação'],['ia','Insights IA']].map(([id,label]) => <a key={id} href={`#${id}`} className="rounded-xl px-3 py-2 text-muted-foreground transition hover:bg-glass-strong hover:text-foreground">{label}</a>)}
          </nav>
          <div className="flex gap-2"><Button variant="glass" className="hidden rounded-xl sm:inline-flex" onClick={() => setDialogOpen(true)}><Plus />Novo lançamento</Button><Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</Button><Button variant="ghost" size="icon" aria-label="Sair" onClick={() => supabase.auth.signOut()}><LogOut /></Button></div>
          {mobileMenu && <nav className="absolute left-4 right-4 top-[76px] grid gap-1 rounded-2xl border border-glass-border bg-glass-strong p-2 shadow-glass backdrop-blur-xl md:hidden">{[['resumo','Visão geral'],['movimentos','Movimentos'],['relatorios','Relatórios'],['conciliacao','Conciliação'],['ia','Insights IA']].map(([id,label]) => <a key={id} href={`#${id}`} onClick={() => setMobileMenu(false)} className="rounded-xl px-4 py-3 text-sm font-medium">{label}</a>)}</nav>}
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

        <section id="movimentos" className="mt-6 scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-4 shadow-glass backdrop-blur-xl sm:p-6"><div className="flex items-center justify-between"><div><h2 className="font-display text-xl font-bold">Movimentos recentes</h2><p className="text-xs text-muted-foreground">Entradas e saídas organizadas por categoria</p></div><Button variant="glass" className="rounded-xl" onClick={() => setDialogOpen(true)}><Plus />Adicionar</Button></div><div className="mt-5 divide-y divide-border">{monthTransactions.length ? monthTransactions.slice(0,10).map((t) => { const cat = categories.find((c) => c.id === t.category_id); return <div key={t.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3 sm:grid-cols-[auto_1fr_auto_auto]"><span className={`grid size-9 place-items-center rounded-xl ${t.type === 'income' ? 'bg-income/10 text-income' : 'bg-expense/10 text-expense'}`}>{t.type === 'income' ? <ArrowUp /> : <ArrowDown />}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{t.description}</p><p className="text-xs text-muted-foreground">{cat?.name ?? 'Sem categoria'} · {new Intl.DateTimeFormat('pt-BR').format(new Date(`${t.transaction_date}T12:00:00`))}</p></div><span className={`font-display text-sm font-bold ${t.type === 'income' ? 'text-income' : 'text-expense'}`}>{t.type === 'income' ? '+' : '-'} {money.format(Number(t.amount))}</span><span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-semibold sm:block ${t.reconciled ? 'bg-income/10 text-income' : 'bg-warning/15 text-foreground'}`}>{t.reconciled ? 'Conciliado' : 'Pendente'}</span></div>}) : <EmptyState onAdd={() => setDialogOpen(true)} />}</div></section>

        <section id="conciliacao" className="my-6 scroll-mt-28 rounded-3xl border border-glass-border bg-glass p-4 shadow-glass backdrop-blur-xl sm:p-6"><div className="flex items-center justify-between"><div><h2 className="font-display text-xl font-bold">Conciliação</h2><p className="text-xs text-muted-foreground">Confirme os gastos que já conferiu no extrato</p></div><span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold">{monthTransactions.filter((t) => !t.reconciled).length} pendentes</span></div><div className="mt-4 grid gap-3 md:grid-cols-2">{monthTransactions.filter((t) => !t.reconciled).map((t) => <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-glass-strong p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{t.description}</p><p className="text-xs text-muted-foreground">{money.format(Number(t.amount))}</p></div><Button variant="glass" size="sm" className="rounded-xl" onClick={() => reconcile(t.id)}><Check />Conciliar</Button></div>)}</div></section>
      </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-brand">{notice}<button className="ml-4" onClick={() => setNotice("")} aria-label="Fechar aviso">×</button></div>}
      <TransactionDialog open={dialogOpen} setOpen={setDialogOpen} onSave={saveTransaction} />
    </main>
  );
}

function Logo() { return <span className="grid size-11 place-items-center rounded-2xl bg-hero font-display text-lg font-bold text-primary-foreground shadow-brand">E</span>; }
function Metric({ label, value, tone }: { label: string; value: number; tone: "income" | "expense" }) { return <div className="rounded-2xl bg-glass-strong p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-display text-base font-bold ${tone === 'income' ? 'text-income' : 'text-expense'}`}>{money.format(value)}</p></div>; }
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="grid place-items-center py-12 text-center"><WalletCards className="mb-3 size-9 text-primary"/><p className="font-semibold">Seu mês começa aqui</p><p className="mb-4 text-sm text-muted-foreground">Cadastre uma entrada ou despesa para visualizar seus relatórios.</p><Button variant="hero" className="rounded-xl" onClick={onAdd}><Plus />Novo lançamento</Button></div>; }

function AuthScreen({ mode, setMode, email, setEmail, password, setPassword, error, onSubmit }: { mode: "login" | "signup"; setMode: (v: "login" | "signup") => void; email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; error: string; onSubmit: (e: FormEvent) => void }) {
  async function google() { await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }); }
  return <main className="grid min-h-screen place-items-center px-4"><section className="w-full max-w-md rounded-3xl border border-glass-border bg-glass p-7 shadow-glass backdrop-blur-xl"><div className="mb-7 flex items-center gap-3"><Logo/><div><h1 className="font-display text-2xl font-bold">ESF</h1><p className="text-sm text-muted-foreground">Seu dinheiro com mais clareza.</p></div></div><div className="mb-5 grid grid-cols-2 rounded-xl bg-glass p-1"><button className={`rounded-lg py-2 text-sm font-semibold ${mode === 'login' ? 'bg-glass-strong shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('login')}>Entrar</button><button className={`rounded-lg py-2 text-sm font-semibold ${mode === 'signup' ? 'bg-glass-strong shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signup')}>Criar conta</button></div><form className="space-y-3" onSubmit={onSubmit}><Input type="email" required placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl bg-glass-strong"/><Input type="password" required minLength={6} placeholder="Sua senha" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl bg-glass-strong"/><Button variant="hero" className="h-11 w-full rounded-xl">{mode === 'login' ? 'Entrar no ESF' : 'Criar minha conta'}</Button></form><div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/>ou<span className="h-px flex-1 bg-border"/></div><Button variant="glass" className="h-11 w-full rounded-xl" onClick={google}>Continuar com Google</Button>{error && <p className="mt-4 rounded-xl bg-expense/10 p-3 text-sm text-expense">{error}</p>}</section></main>;
}

function TransactionDialog({ open, setOpen, onSave }: { open: boolean; setOpen: (v: boolean) => void; onSave: (e: FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0,10);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="rounded-3xl border-glass-border bg-glass-strong backdrop-blur-xl"><DialogHeader><DialogTitle className="font-display text-2xl">Novo lançamento</DialogTitle><DialogDescription>Registre uma entrada ou saída e organize por categoria.</DialogDescription></DialogHeader><form onSubmit={onSave} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Tipo<select name="type" className="h-10 rounded-xl border border-input bg-background px-3"><option value="expense">Despesa</option><option value="income">Entrada</option></select></label><label className="grid gap-1.5 text-sm font-medium">Descrição<Input name="description" required maxLength={120} placeholder="Ex.: Supermercado" className="h-10 rounded-xl"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">Valor<Input name="amount" required type="number" min="0.01" step="0.01" placeholder="0,00" className="h-10 rounded-xl"/></label><label className="grid gap-1.5 text-sm font-medium">Data<Input name="date" required type="date" defaultValue={today} className="h-10 rounded-xl"/></label></div><label className="grid gap-1.5 text-sm font-medium">Categoria<Input name="category" required maxLength={60} placeholder="Ex.: Moradia" className="h-10 rounded-xl"/></label><Button variant="hero" className="mt-2 h-11 rounded-xl"><Plus />Salvar lançamento</Button></form></DialogContent></Dialog>;
}
