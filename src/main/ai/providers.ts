import type { AiConfig } from '../../shared/types';

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface StreamAiOptions {
  config: AiConfig;
  apiKey: string;
  system: string;
  messages: AiChatMessage[];
  tools: AiToolDefinition[];
  signal: AbortSignal;
  onText?: (text: string) => void;
}

function openAiEndpoint(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

function anthropicEndpoint(baseUrl: string): string {
  if (baseUrl.endsWith('/messages')) return baseUrl;
  if (/\/v1$/.test(baseUrl)) return `${baseUrl}/messages`;
  return `${baseUrl}/v1/messages`;
}

async function readErrorMessage(response: Response): Promise<string> {
  let text = '';
  try {
    text = (await response.text()).slice(0, 4000);
  } catch {
    text = '';
  }
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message ?? parsed.message ?? text;
  } catch {
    // Keep the raw text when the provider does not return JSON.
  }
  return `Nhà cung cấp AI trả về lỗi ${response.status}: ${detail || response.statusText}`;
}

async function readSse(
  response: Response,
  onEvent: (eventName: string, data: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error('Nhà cung cấp AI không trả về nội dung.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (block: string) => {
    let eventName = '';
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) onEvent(eventName, dataLines.join('\n'));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let separator = buffer.indexOf('\n\n');
    while (separator >= 0) {
      consume(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
}

function openAiMessages(messages: AiChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function anthropicMessages(messages: AiChatMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      const content: Record<string, unknown>[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments || '{}') as unknown;
        } catch {
          input = {};
        }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      result.push({ role: 'assistant', content });
      continue;
    }
    result.push({ role: message.role, content: message.content });
  }
  return result;
}

async function streamOpenAi(options: StreamAiOptions): Promise<{ text: string; toolCalls: AiToolCall[] }> {
  const { config, apiKey, messages, tools, signal, onText } = options;
  const response = await fetch(openAiEndpoint(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: openAiMessages(messages),
      tools: tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      tool_choice: 'auto',
      temperature: config.temperature,
      max_tokens: 1500,
      stream: true,
    }),
    signal,
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));

  let text = '';
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  await readSse(response, (_event, data) => {
    if (data === '[DONE]') return;
    let parsed: {
      error?: { message?: string };
      choices?: {
        delta?: {
          content?: string;
          tool_calls?: {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.error?.message) throw new Error(parsed.error.message);
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      text += delta.content;
      onText?.(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? 0;
      const current = calls.get(index) ?? { id: `call_${index}`, name: '', arguments: '' };
      if (part.id) current.id = part.id;
      if (part.function?.name) current.name = part.function.name;
      if (part.function?.arguments) current.arguments += part.function.arguments;
      calls.set(index, current);
    }
  });

  return {
    text,
    toolCalls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => Boolean(call.name)),
  };
}

async function streamAnthropic(
  options: StreamAiOptions,
): Promise<{ text: string; toolCalls: AiToolCall[] }> {
  const { config, apiKey, system, messages, tools, signal, onText } = options;
  const response = await fetch(anthropicEndpoint(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system,
      messages: anthropicMessages(messages),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      temperature: config.temperature,
      max_tokens: 1500,
      stream: true,
    }),
    signal,
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));

  let text = '';
  const calls: AiToolCall[] = [];
  const openCalls = new Map<number, AiToolCall>();

  await readSse(response, (_event, data) => {
    let parsed: {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.type === 'error') {
      throw new Error(parsed.error?.message || 'Nhà cung cấp AI trả về lỗi.');
    }
    if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
      openCalls.set(parsed.index ?? 0, {
        id: parsed.content_block.id ?? `call_${parsed.index ?? 0}`,
        name: parsed.content_block.name ?? '',
        arguments: '',
      });
      return;
    }
    if (parsed.type === 'content_block_delta') {
      if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
        text += parsed.delta.text;
        onText?.(parsed.delta.text);
      } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json) {
        const current = openCalls.get(parsed.index ?? 0);
        if (current) current.arguments += parsed.delta.partial_json;
      }
      return;
    }
    if (parsed.type === 'content_block_stop') {
      const current = openCalls.get(parsed.index ?? 0);
      if (current) {
        calls.push(current);
        openCalls.delete(parsed.index ?? 0);
      }
    }
  });

  for (const call of openCalls.values()) calls.push(call);
  return { text, toolCalls: calls.filter((call) => Boolean(call.name)) };
}

export async function streamAi(
  options: StreamAiOptions,
): Promise<{ text: string; toolCalls: AiToolCall[] }> {
  return options.config.provider === 'anthropic' ? streamAnthropic(options) : streamOpenAi(options);
}

export async function pingAi(config: AiConfig, apiKey: string): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const isAnthropic = config.provider === 'anthropic';
    const response = await fetch(
      isAnthropic ? anthropicEndpoint(config.baseUrl) : openAiEndpoint(config.baseUrl),
      {
        method: 'POST',
        headers: isAnthropic
          ? {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            }
          : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          ...(isAnthropic ? {} : { stream: false }),
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return { ok: false, message: await readErrorMessage(response) };
    return { ok: true, message: `Kết nối thành công tới ${config.model}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message.includes('aborted') ? 'Hết thời gian kết nối tới nhà cung cấp AI.' : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
