-- The parts of ARCHITECTURE.md §6.2 that the Prisma schema language cannot express.

-- Prisma creates list columns as nullable.
ALTER TABLE sales ALTER COLUMN flags SET NOT NULL;

-- Check constraints. inventory_levels.on_hand deliberately has none (ARCH §5).
ALTER TABLE staff
  ADD CONSTRAINT staff_role_check CHECK (role IN ('cashier','manager','owner'));
ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_price_cents_check CHECK (price_cents >= 0);
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_delta_check CHECK (delta <> 0),
  ADD CONSTRAINT stock_movements_reason_check CHECK (reason IN
    ('sale','void','return','receive','adjustment','count','transfer_in','transfer_out'));
ALTER TABLE stock_discrepancies
  ADD CONSTRAINT stock_discrepancies_status_check CHECK (status IN ('open','resolved'));
ALTER TABLE sync_inbox
  ADD CONSTRAINT sync_inbox_status_check CHECK (status IN ('applied','parked','rejected'));
ALTER TABLE sales
  ADD CONSTRAINT sales_status_check CHECK (status IN ('completed','voided'));
ALTER TABLE sale_lines
  ADD CONSTRAINT sale_lines_qty_check CHECK (qty > 0);
ALTER TABLE payments
  ADD CONSTRAINT payments_method_check CHECK (method IN ('cash','card'));
ALTER TABLE return_lines
  ADD CONSTRAINT return_lines_qty_check CHECK (qty > 0);
ALTER TABLE refunds
  ADD CONSTRAINT refunds_method_check CHECK (method IN ('cash','card','store_credit'));

-- Partial indexes
CREATE UNIQUE INDEX one_open_discrepancy
  ON stock_discrepancies (store_id, variant_id) WHERE status = 'open';
CREATE INDEX sync_inbox_status_idx ON sync_inbox (status) WHERE status <> 'applied';
CREATE INDEX sync_inbox_parked_sale_idx
  ON sync_inbox ((payload ->> 'originalSaleId')) WHERE status = 'parked';

-- updated_at is the pull cursor (ARCH §4.6), so every write is stamped by the database clock.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
CREATE TRIGGER products_set_updated_at BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER product_variants_set_updated_at BEFORE INSERT OR UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_levels_set_updated_at BEFORE INSERT OR UPDATE ON inventory_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
