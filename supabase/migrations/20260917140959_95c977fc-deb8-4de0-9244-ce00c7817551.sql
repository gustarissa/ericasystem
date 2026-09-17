ALTER TABLE public.transactions
  ADD COLUMN is_card_invoice boolean NOT NULL DEFAULT false,
  ADD COLUMN card_name text;

CREATE TABLE public.card_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_purchases TO authenticated;
GRANT ALL ON public.card_purchases TO service_role;

ALTER TABLE public.card_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_purchases_select_own"
ON public.card_purchases FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "card_purchases_insert_own"
ON public.card_purchases FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.id = transaction_id
      AND transactions.user_id = auth.uid()
      AND transactions.is_card_invoice = true
  )
);

CREATE POLICY "card_purchases_update_own"
ON public.card_purchases FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.id = transaction_id
      AND transactions.user_id = auth.uid()
      AND transactions.is_card_invoice = true
  )
);

CREATE POLICY "card_purchases_delete_own"
ON public.card_purchases FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX card_purchases_transaction_idx ON public.card_purchases(transaction_id);
CREATE INDEX card_purchases_user_date_idx ON public.card_purchases(user_id, purchase_date DESC);

CREATE TRIGGER card_purchases_set_updated_at
BEFORE UPDATE ON public.card_purchases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();