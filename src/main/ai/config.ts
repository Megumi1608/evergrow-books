import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AiConfig, AiConfigInput, AiProvider } from '../../shared/types';

interface StoredAiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  temperature: number;
  enabled: boolean;
  keyCipher?: string;
  keyHint?: string;
}

const DEFAULT_CONFIG: StoredAiConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  enabled: true,
};

function readStored(file: string): StoredAiConfig {
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoredAiConfig>;
    return {
      provider: parsed.provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_CONFIG.baseUrl,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_CONFIG.model,
      temperature:
        typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)
          ? Math.min(1, Math.max(0, parsed.temperature))
          : DEFAULT_CONFIG.temperature,
      enabled: parsed.enabled !== false,
      keyCipher: typeof parsed.keyCipher === 'string' ? parsed.keyCipher : undefined,
      keyHint: typeof parsed.keyHint === 'string' ? parsed.keyHint : undefined,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeStored(file: string, config: StoredAiConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

export function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Base URL không hợp lệ.');
  }
  if (url.username || url.password) throw new Error('Base URL không được chứa thông tin đăng nhập.');
  if (url.protocol === 'https:') return value;
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol === 'http:' && localHosts.has(url.hostname)) return value;
  throw new Error('Chỉ chấp nhận HTTPS, hoặc HTTP với localhost/127.0.0.1.');
}

export function publicAiConfig(file: string): AiConfig {
  const stored = readStored(file);
  return {
    provider: stored.provider,
    baseUrl: stored.baseUrl,
    model: stored.model,
    temperature: stored.temperature,
    enabled: stored.enabled,
    hasKey: Boolean(stored.keyCipher),
    keyHint: stored.keyHint ?? '',
  };
}

export function saveAiConfig(file: string, input: AiConfigInput): AiConfig {
  const current = readStored(file);
  const provider: AiProvider = input.provider === 'anthropic' ? 'anthropic' : 'openai';
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = input.model.trim();
  if (!model) throw new Error('Chưa nhập tên model.');
  if (model.length > 120) throw new Error('Tên model quá dài.');
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? Math.min(1, Math.max(0, input.temperature))
      : current.temperature;

  let keyCipher = current.keyCipher;
  let keyHint = current.keyHint;
  if (input.clearKey) {
    keyCipher = undefined;
    keyHint = undefined;
  }
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Hệ điều hành không hỗ trợ lưu API key an toàn trên máy này.');
    }
    keyCipher = safeStorage.encryptString(apiKey).toString('base64');
    keyHint = apiKey.slice(-4);
  }

  writeStored(file, {
    provider,
    baseUrl,
    model,
    temperature,
    enabled: input.enabled !== false,
    keyCipher,
    keyHint,
  });
  return publicAiConfig(file);
}

export function clearAiKey(file: string): AiConfig {
  const current = readStored(file);
  writeStored(file, { ...current, keyCipher: undefined, keyHint: undefined });
  return publicAiConfig(file);
}

export function aiSecret(file: string): { config: AiConfig; apiKey: string } {
  const stored = readStored(file);
  if (!stored.keyCipher) throw new Error('Chưa cấu hình API key cho trợ lý.');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Không thể giải mã API key trên máy này.');
  }
  let apiKey = '';
  try {
    apiKey = safeStorage.decryptString(Buffer.from(stored.keyCipher, 'base64'));
  } catch {
    throw new Error('Không giải mã được API key. Hãy nhập lại API key.');
  }
  return {
    config: {
      provider: stored.provider,
      baseUrl: stored.baseUrl,
      model: stored.model,
      temperature: stored.temperature,
      enabled: stored.enabled,
      hasKey: true,
      keyHint: stored.keyHint ?? '',
    },
    apiKey,
  };
}
