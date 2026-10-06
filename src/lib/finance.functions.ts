import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InsightInput = z.object({
  income: z.number().nonnegative(),
  expenses: z.number().nonnegative(),
  balance: z.number(),
  monthlyReserve: z.number().nonnegative(),
  overdueAmount: z.number().nonnegative(),
  pendingReconciliations: z.number().int().nonnegative(),
  cardInvoiceTotal: z.number().nonnegative(),
  topCategory: z.string().max(60),
  topCategoryAmount: z.number().nonnegative(),
});

type InsightData = z.infer<typeof InsightInput>;

function automaticInsight(data: InsightData) {
  const spendingRate = data.income > 0 ? (data.expenses / data.income) * 100 : 0;
  const reserveRate = data.income > 0 ? (data.monthlyReserve / data.income) * 100 : 0;
  const targetReserve = data.income * 0.1;
  const suggestions = [
    data.balance < 0
      ? "Gastos: suas despesas superam as entradas. Revise primeiro " + data.topCategory + ", hoje em R$ " + data.topCategoryAmount.toFixed(2).replace(".", ",") + "."
      : "Gastos: você comprometeu " + spendingRate.toFixed(1).replace(".", ",") + "% da renda. Acompanhe " + data.topCategory + ", sua maior categoria no mês.",
    data.monthlyReserve > 0
      ? "Reserva: você separou " + reserveRate.toFixed(1).replace(".", ",") + "% da renda. Mantenha a quantia protegida e aumente gradualmente se o orçamento permitir."
      : "Reserva: tente separar até R$ " + targetReserve.toFixed(2).replace(".", ",") + " neste mês, começando por um valor que caiba no orçamento.",
    data.overdueAmount > 0
      ? "Prioridade: existem R$ " + data.overdueAmount.toFixed(2).replace(".", ",") + " em lançamentos vencidos. Regularize-os antes de assumir novos investimentos."
      : "Investimentos: com as contas controladas, avalie alternativas compatíveis com prazo e tolerância a risco. Investimentos não garantem retorno.",
  ];
  const attention = data.pendingReconciliations > 0
    ? " Há " + data.pendingReconciliations + " lançamento(s) pendente(s) de conciliação."
    : "";
  return suggestions.map((suggestion, index) => (index + 1) + ". " + suggestion).join("\n") + attention;
}

export const generateFinancialInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InsightInput.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { text: automaticInsight(data), generatedBy: "automatic" as const };

    const prompt =
      "Dados do mês: entradas R$ " + data.income.toFixed(2) +
      ", despesas R$ " + data.expenses.toFixed(2) +
      ", saldo R$ " + data.balance.toFixed(2) +
      ", reserva R$ " + data.monthlyReserve.toFixed(2) +
      ", vencidos R$ " + data.overdueAmount.toFixed(2) +
      ", faturas R$ " + data.cardInvoiceTotal.toFixed(2) +
      ", conciliações pendentes " + data.pendingReconciliations +
      ", maior categoria " + data.topCategory + " com R$ " + data.topCategoryAmount.toFixed(2) +
      ". Analise os dados e dê três orientações práticas e específicas.";

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        },
        body: JSON.stringify({
          model: "google/gemini-3.7-flash",
          messages: [
            {
              role: "system",
              content: "Você é o consultor financeiro do ESF. Responda em português do Brasil, em até 150 palavras. Dê três sugestões numeradas, práticas e prudentes: uma sobre gastos, uma sobre reserva e uma sobre prioridades ou investimentos. Use os valores informados, nunca prometa retorno e deixe claro que investimentos envolvem riscos.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.35,
          max_tokens: 350,
        }),
      });

      if (!response.ok) return { text: automaticInsight(data), generatedBy: "automatic" as const };
      const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = result.choices?.[0]?.message?.content?.trim();
      return { text: text || automaticInsight(data), generatedBy: text ? "ai" as const : "automatic" as const };
    } catch {
      return { text: automaticInsight(data), generatedBy: "automatic" as const };
    }
  });
