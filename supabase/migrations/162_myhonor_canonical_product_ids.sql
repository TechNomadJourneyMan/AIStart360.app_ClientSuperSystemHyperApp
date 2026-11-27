-- Tighten existing analytics tables to the canonical public-catalog product id.
-- Migration 079 already uses this constraint for fresh installs; this additive
-- migration upgrades environments where 079 was applied before the tightening.
-- (079-083 were numbered 075-079 before the AIStart360 merge; environments that
-- ran the old numbers need no re-run — the file bodies are unchanged.)

ALTER TABLE public.ecommerce_products
  DROP CONSTRAINT IF EXISTS ecommerce_products_external_id_check;
ALTER TABLE public.ecommerce_products
  ADD CONSTRAINT ecommerce_products_external_id_check
  CHECK (external_id ~ '^myhonor:[a-f0-9]{64}$') NOT VALID;
ALTER TABLE public.ecommerce_products
  VALIDATE CONSTRAINT ecommerce_products_external_id_check;

ALTER TABLE public.ecommerce_order_items
  DROP CONSTRAINT IF EXISTS ecommerce_order_items_product_external_id_check;
ALTER TABLE public.ecommerce_order_items
  ADD CONSTRAINT ecommerce_order_items_product_external_id_check
  CHECK (product_external_id ~ '^myhonor:[a-f0-9]{64}$') NOT VALID;
ALTER TABLE public.ecommerce_order_items
  VALIDATE CONSTRAINT ecommerce_order_items_product_external_id_check;
