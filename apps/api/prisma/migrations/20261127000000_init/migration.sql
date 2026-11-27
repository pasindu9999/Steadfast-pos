-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "currency" CHAR(3) NOT NULL DEFAULT 'AUD',
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 1000,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
    "cash_rounding_cents" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminals" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "device_token_hash" TEXT,
    "enrolment_code_hash" TEXT,
    "enrolment_code_reusable" BOOLEAN NOT NULL DEFAULT false,
    "enrolment_code_used_at" TIMESTAMPTZ(6),
    "last_applied_seq" BIGINT NOT NULL DEFAULT 0,
    "receipt_seq" BIGINT NOT NULL DEFAULT 0,
    "return_seq" BIGINT NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category_id" UUID,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "size" TEXT NOT NULL,
    "size_sort" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "cost_cents" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("store_id","variant_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "terminal_id" UUID,
    "staff_id" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_discrepancies" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand_at_detection" INTEGER NOT NULL,
    "trigger_event_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution_note" TEXT,

    CONSTRAINT "stock_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_inbox" (
    "event_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "sync_inbox_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "store_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "staff_id" UUID,
    "customer_id" UUID,
    "status" TEXT NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL,
    "rounding_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "cart_discount" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku_snapshot" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "line_discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "promotion_id" UUID,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "tendered_cents" INTEGER,
    "change_cents" INTEGER,
    "card_reference" TEXT,
    "card_last4" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "original_sale_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "staff_id" UUID,
    "reason" TEXT,
    "refund_total_cents" INTEGER NOT NULL,
    "rounding_cents" INTEGER NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "refund_cents" INTEGER NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "card_reference" TEXT,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_code_key" ON "stores"("code");

-- CreateIndex
CREATE UNIQUE INDEX "terminals_device_token_hash_key" ON "terminals"("device_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "terminals_enrolment_code_hash_key" ON "terminals"("enrolment_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "terminals_store_id_code_key" ON "terminals"("store_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "product_variants"("barcode");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_updated_at_id_idx" ON "product_variants"("updated_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_size_color_key" ON "product_variants"("product_id", "size", "color");

-- CreateIndex
CREATE INDEX "stock_movements_store_id_variant_id_occurred_at_idx" ON "stock_movements"("store_id", "variant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_inbox_terminal_id_seq_key" ON "sync_inbox"("terminal_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "sales_receipt_no_key" ON "sales"("receipt_no");

-- CreateIndex
CREATE INDEX "sales_store_id_occurred_at_idx" ON "sales"("store_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_sale_id_line_no_key" ON "sale_lines"("sale_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "returns_return_no_key" ON "returns"("return_no");

-- CreateIndex
CREATE INDEX "returns_original_sale_id_idx" ON "returns"("original_sale_id");

-- CreateIndex
CREATE INDEX "return_lines_sale_line_id_idx" ON "return_lines"("sale_line_id");

-- AddForeignKey
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_inbox" ADD CONSTRAINT "sync_inbox_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_original_sale_id_fkey" FOREIGN KEY ("original_sale_id") REFERENCES "sales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_sale_line_id_fkey" FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
