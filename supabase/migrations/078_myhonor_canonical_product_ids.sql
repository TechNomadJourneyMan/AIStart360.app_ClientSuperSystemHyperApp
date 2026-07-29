-- Tighten existing analytics tables to the canonical public-catalog product id.
-- Migration 075 already uses this constraint for fresh installs; this additive
-- migration upgrades environments where 075 was applied before the tightening.

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
