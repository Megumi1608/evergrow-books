import type { EvergrowApi } from '../shared/types';

export const api: EvergrowApi = window.api;

export function getErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .split('\n')[0]
    .trim();
}
