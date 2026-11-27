/** Rows of the local database (ARCH §6.3). Documents mirror the contracts in `@pos/core`. */
import type {
  PaymentPayload,
  PullProduct,
  PullStaff,
  PullStore,
  PullVariant,
  ReturnCompletedPayload,
  ReturnLinePayload,
  SaleCompletedPayload,
  SaleLinePayload,
  SaleStatus,
  SyncEvent,
} from '@pos/core';

export type ProductRow = PullProduct;
export type VariantRow = PullVariant;
export type StaffRow = PullStaff;

export interface InventoryRow {
  variantId: string;
  /** The server's level at the last pull. Local unsynced deltas are added on top (ARCH §4.6). */
  serverOnHand: number;
}

export interface SaleRow extends Omit<SaleCompletedPayload, 'saleId' | 'lines' | 'payments'> {
  id: string;
  terminalId: string;
  status: SaleStatus;
  occurredAt: string;
}

export interface SaleLineRow extends Omit<SaleLinePayload, 'lineId'> {
  id: string;
  saleId: string;
}

export interface PaymentRow extends Omit<PaymentPayload, 'paymentId'> {
  id: string;
  saleId: string;
}

/** Refunds stay on the return: §6.3 gives them no table of their own. */
export interface ReturnRow extends Omit<ReturnCompletedPayload, 'returnId' | 'lines'> {
  id: string;
  terminalId: string;
  occurredAt: string;
}

export interface ReturnLineRow extends Omit<ReturnLinePayload, 'returnLineId'> {
  id: string;
  returnId: string;
}

/** IndexedDB cannot index booleans. */
export type SyncedFlag = 0 | 1;

export interface StockMovementRow {
  id: string;
  variantId: string;
  delta: number;
  reason: 'sale' | 'void' | 'return';
  sourceType: 'sale' | 'return';
  sourceId: string;
  /** The outbox event that carries this movement to the server. */
  seq: number;
  synced: SyncedFlag;
  occurredAt: string;
}

/** `failed`: the server rejected the event, so it needs attention. */
export type OutboxStatus = 'pending' | 'synced' | 'failed';

/** The immutable event as it will be sent, plus its local delivery status. */
export type OutboxRow = SyncEvent & { status: OutboxStatus };

export interface PinAttempt {
  failures: number;
  /** ISO-8601, or `null` while not locked. */
  lockedUntil: string | null;
}

export interface SettingValues {
  apiUrl: string;
  deviceToken: string;
  terminalId: string;
  terminalCode: string;
  /** The last number used by each counter. */
  receiptSeq: number;
  returnSeq: number;
  outboxSeq: number;
  store: PullStore;
  pullCursor: string;
  lastPulledAt: string;
  /** Failed PIN attempts by staff id (ARCH §11). */
  pinAttempts: Record<string, PinAttempt>;
}

export type SettingKey = keyof SettingValues;

export interface SettingRow {
  key: SettingKey;
  value: SettingValues[SettingKey];
}
