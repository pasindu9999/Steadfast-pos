import type { PullStore } from '@pos/core';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

import type { CatalogIndex } from '../catalog/catalog-index';
import type { CartStore } from '../checkout/cart-store';
import type { RegisterState } from '../checkout/register-store';
import type { Session } from '../staff/session-store';
import type { Services } from './services';

/** Local data every till screen reads. It is loaded before any of them is shown. */
export interface RegisterData {
  catalog: CatalogIndex;
  store: PullStore;
  terminalCode: string;
}

export const ServicesContext = createContext<Services | null>(null);
export const RegisterContext = createContext<RegisterData | null>(null);

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} is missing`);
  return value;
}

export function useServices(): Services {
  return required(useContext(ServicesContext), 'ServicesContext');
}

export function useRegister(): RegisterData {
  return required(useContext(RegisterContext), 'RegisterContext');
}

export function useCart<T>(selector: (cart: CartStore) => T): T {
  return useStore(useServices().stores.cart, selector);
}

export function useSession<T>(selector: (session: Session) => T): T {
  return useStore(useServices().stores.session, selector);
}

export function useRegisterState<T>(selector: (register: RegisterState) => T): T {
  return useStore(useServices().stores.register, selector);
}
