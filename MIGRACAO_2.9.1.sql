-- Execute no Supabase SQL Editor ANTES de publicar a 2.9.1.
-- Não reclassifica lançamentos antigos: financial_nature fica NULL nesses registros.
ALTER TABLE public.ff2_transactions ADD COLUMN IF NOT EXISTS financial_nature text;
ALTER TABLE public.ff2_transactions DROP CONSTRAINT IF EXISTS ff2_transactions_financial_nature_check;
ALTER TABLE public.ff2_transactions ADD CONSTRAINT ff2_transactions_financial_nature_check CHECK (financial_nature IS NULL OR financial_nature IN ('consumption','allocation','transfer','resgate','income'));
CREATE INDEX IF NOT EXISTS ff2_transactions_financial_nature_idx ON public.ff2_transactions (user_id, financial_nature);
