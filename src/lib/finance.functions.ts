import { createServerFn } from "@tanstack/react-start";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InsightInput = z.object({
  income: z.number().nonnegative(),
  expenses: z.number().nonnegative(),
  balance: z.number(),
  topCategory: z.string().max(60),
  topCategoryAmount: z.number().nonnegative(),
});

export const generateFinancialInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InsightInput.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("A análise por IA ainda não está configurada.");

    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey },
    });
    const result = streamText({
      model: lovable.responses("openai/gpt-6-astra"),
      system:
        "Você é o consultor financeiro do ESF. Responda em português do Brasil, em até 120 palavras. Dê três sugestões práticas e prudentes: uma sobre gastos, uma sobre reserva e uma sobre investimentos. Nunca prometa retorno, deixe claro que investimentos têm risco e não substitua aconselhamento profissional.",
      prompt: `Dados do mês: entradas R$ ${data.income.toFixed(2)}, despesas R$ ${data.expenses.toFixed(2)}, saldo R$ ${data.balance.toFixed(2)}, maior categoria ${data.topCategory} com R$ ${data.topCategoryAmount.toFixed(2)}. Analise e sugira melhorias.`,
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "medium",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });

    const text = await result.text;
    return { text: text || "Não foi possível gerar uma recomendação neste momento." };
  });