import Dexie, { type Table } from 'dexie';

import type {
  InventoryRow,
  OutboxRow,
  PaymentRow,
  ProductRow,
  ReturnLineRow,
  ReturnRow,
  SaleLineRow,
  SaleRow,
  SettingKey,
  SettingRow,
  StaffRow,
  StockMovementRow,
  VariantRow,
} from './types';

export const DATABASE_NAME = 'pos';

export class PosDatabase extends Dexie {
  // `declare`: a real class field would overwrite the table Dexie creates.
  declare settings: Table<SettingRow, SettingKey>;
  declare products: Table<ProductRow, string>;
  declare variants: Table<VariantRow, string>;
  declare inventory: Table<InventoryRow, string>;
  declare staff: Table<StaffRow, string>;
  declare sales: Table<SaleRow, string>;
  declare saleLines: Table<SaleLineRow, string>;
  declare payments: Table<PaymentRow, string>;
  declare returns: Table<ReturnRow, string>;
  declare returnLines: Table<ReturnLineRow, string>;
  declare stockMovements: Table<StockMovementRow, string>;
  declare outbox: Table<OutboxRow, number>;

  constructor(name: string = DATABASE_NAME) {
    super(name);
    // ARCH §6.3. Change it only by adding a new version; the outbox is never dropped (§13).
    this.version(1).stores({
      settings: 'key',
      products: 'id, name, updatedAt',
      variants: 'id, &sku, barcode, productId, updatedAt',
      inventory: 'variantId',
      staff: 'id',
      sales: 'id, &receiptNo, occurredAt',
      saleLines: 'id, saleId, variantId',
      payments: 'id, saleId',
      returns: 'id, &returnNo, originalSaleId, occurredAt',
      returnLines: 'id, returnId, saleLineId',
      stockMovements: 'id, variantId, synced',
      // No `++`: seq comes from `settings.outboxSeq` inside the commit transaction (§4.2).
      outbox: 'seq, &eventId, status',
    });
  }
}

export const db = new PosDatabase();
