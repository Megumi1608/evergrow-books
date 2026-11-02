import { createContext, useContext } from 'react';
import type { AppMeta, Transaction, UpdateState } from '../shared/types';

export interface AppContextValue {
  meta: AppMeta | null;
  companyName: string;
  revision: number;
  updateState: UpdateState;
  bump: () => void;
  reloadSettings: () => Promise<void>;
  openTransaction: (transaction?: Transaction) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext chưa được khởi tạo.');
  return value;
}
