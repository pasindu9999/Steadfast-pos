/** Rows of the local database (ARCH §6.3). Documents mirror the contracts in `@pos/core`. */
import type {
  ErrorDetail,
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

import type { Cart } from '../checkout/cart';

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
  /** Both set when the sale is voided. */
  voidedAt?: string;
  voidReason?: string | null;
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
  /** Local only, for the return receipt: the sale may not be stored here. */
  originalReceiptNo: string;
}

export interface ReturnLineRow extends Omit<ReturnLinePayload, 'returnLineId'> {
  id: string;
  returnId: string;
  /** Local only: the item's name as shown when it was returned. */
  nameSnapshot: string;
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

/**
 * The immutable event as it will be sent, plus what happened to it here: its delivery status and,
 * once `failed`, why the server rejected it. The local fields are never sent.
 */
export type OutboxRow = SyncEvent & { status: OutboxStatus; error?: ErrorDetail };

/** Why the terminal stopped syncing until someone acts (ARCH §4.7). */
export type HaltReason = 'UNAUTHORIZED' | 'TERMINAL_MISMATCH' | 'SEQ_REUSED' | 'SEQ_GAP';

export interface SyncHalt {
  reason: HaltReason;
  /** ISO-8601. */
  at: string;
}

export interface PinAttempt {
  failures: number;
  /** ISO-8601, or `null` while not locked. */
  lockedUntil: string | null;
}

export interface ParkedSale {
  id: string;
  parkedAt: string;
  /** Who set it aside. */
  staffName: string | null;
  cart: Cart;
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
  /** Sales set aside to be finished later, oldest first (ARCH §6.3). */
  parkedSales: ParkedSale[];
  /** Present while syncing is stopped. */
  syncHalt: SyncHalt;
  /** When a sync cycle last finished without a problem. */
  lastSyncedAt: string;
}

export type SettingKey = keyof SettingValues;

export interface SettingRow {
  key: SettingKey;
  value: SettingValues[SettingKey];
}
