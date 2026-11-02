import type { EvergrowApi } from '../shared/types';

declare global {
  interface Window {
    api: EvergrowApi;
  }
}

export {};
