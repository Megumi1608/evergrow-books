import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, History, LoaderCircle, MoveDiagonal2, Plus, Send, Sparkles, Square, X } from 'lucide-react';
import type { AiChange, AiConfig, AiMessage, AiSessionSummary } from '../../shared/types';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { AiChangeCard } from './AiChangeCard';
import { AiMarkdown } from './AiMarkdown';
import { AiThinking } from './AiThinking';
import { useToast } from './toast';

const TOOL_LABELS: Record<string, string> = {
  search_transactions: 'Đang tìm giao dịch…',
  get_transaction: 'Đang xem giao dịch…',
  list_categories: 'Đang xem danh mục…',
  list_shipments: 'Đang xem lô hàng…',
  get_shipment: 'Đang xem lô hàng…',
  list_debts: 'Đang xem công nợ…',
  get_budgets: 'Đang xem ngân sách…',
  get_report: 'Đang tổng hợp báo cáo…',
  propose_create_transaction: 'Đang chuẩn bị đề xuất thêm giao dịch…',
  propose_update_transaction: 'Đang chuẩn bị đề xuất sửa giao dịch…',
  propose_delete_transaction: 'Đang chuẩn bị đề xuất xoá giao dịch…',
  propose_pay_debt: 'Đang chuẩn bị ghi thanh toán…',
};

const SUGGESTIONS = [
  'Tổng thu chi tháng này thế nào?',
  'Có khoản công nợ nào quá hạn?',
  'Lô hàng nào đang lỗ?',
];

const DEFAULT_PANEL_SIZE = { width: 400, height: 620 };

function clampPanelSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(Math.max(320, width), Math.max(320, window.innerWidth - 44)),
    height: Math.min(Math.max(400, height), Math.max(400, window.innerHeight - 120)),
  };
}

function readPanelSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem('evergrow.ai.panel');
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return clampPanelSize(parsed.width, parsed.height);
      }
    }
  } catch {
    // Fall back to the default size.
  }
  return clampPanelSize(DEFAULT_PANEL_SIZE.width, DEFAULT_PANEL_SIZE.height);
}

function useSmoothText(target: string, active: boolean): string {
  const [display, setDisplay] = useState('');
  const targetRef = useRef(target);
  const displayRef = useRef('');
  const rafRef = useRef(0);

  useEffect(() => {
    targetRef.current = target;
    const tick = () => {
      const full = targetRef.current;
      const current = displayRef.current;
      if (current.length < full.length) {
        const remaining = full.length - current.length;
        const step = Math.max(3, Math.ceil(remaining * 0.2));
        const next = full.slice(0, current.length + step);
        displayRef.current = next;
        setDisplay(next);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      rafRef.current = 0;
      if (current !== full) {
        displayRef.current = full;
        setDisplay(full);
      }
    };
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [target]);

  useEffect(() => {
    if (!active) {
      displayRef.current = targetRef.current;
      setDisplay(targetRef.current);
    }
  }, [active]);

  return display;
}

function MessageChanges({
  changes,
  busyId,
  batchBusy,
  onApprove,
  onReject,
  onApproveAll,
  allowActions,
}: {
  changes: AiChange[];
  busyId: number | null;
  batchBusy: boolean;
  onApprove: (change: AiChange) => void;
  onReject: (change: AiChange) => void;
  onApproveAll: (changes: AiChange[]) => void;
  allowActions: boolean;
}) {
  const pending = changes.filter((change) => change.status === 'pending');
  return (
    <div className="ai-changes">
      {allowActions && pending.length > 1 ? (
        <div className="ai-batch">
          <span>{pending.length} thay đổi chờ duyệt</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onApproveAll(pending)}
            disabled={batchBusy}
          >
            {batchBusy ? <LoaderCircle size={14} className="spin" /> : null}
            Áp dụng tất cả
          </button>
        </div>
      ) : null}
      {changes.map((change) => (
        <AiChangeCard
          key={change.id}
          change={change}
          busy={busyId === change.id || batchBusy}
          onApprove={allowActions ? () => onApprove(change) : undefined}
          onReject={allowActions ? () => onReject(change) : undefined}
        />
      ))}
    </div>
  );
}

export function AiBubble() {
  const { bump } = useApp();
  const toast = useToast();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [startFresh, setStartFresh] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [liveChanges, setLiveChanges] = useState<AiChange[]>([]);
  const [toolLabel, setToolLabel] = useState('');
  const [error, setError] = useState('');
  const [busyChange, setBusyChange] = useState<number | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [panelSize, setPanelSize] = useState(readPanelSize);
  const panelSizeRef = useRef(panelSize);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const requestRef = useRef('');
  const sessionRef = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const smoothText = useSmoothText(streamText, streaming);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.ai.sessions());
    } catch {
      // Session list is optional for chatting.
    }
  }, []);

  const refreshMessages = useCallback(async (id: string) => {
    if (!id) {
      setMessages([]);
      return;
    }
    try {
      const list = await api.ai.messages(id);
      setMessages(list);
      setSessionId(id);
      sessionRef.current = id;
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    api.ai
      .config()
      .then(setConfig)
      .catch(() => undefined);
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!open) return;
    void api.ai
      .config()
      .then(setConfig)
      .catch(() => undefined);
    void refreshSessions();
  }, [open, refreshSessions]);

  useEffect(() => {
    if (!open || startFresh || sessionId || sessions.length === 0) return;
    void refreshMessages(sessions[0].id);
  }, [open, startFresh, sessionId, sessions, refreshMessages]);

  useEffect(() => {
    const unsubscribe = api.ai.onEvent((event) => {
      if (event.requestId !== requestRef.current) return;
      switch (event.type) {
        case 'delta':
          setToolLabel('');
          setStreamText((current) => current + event.text);
          break;
        case 'proposal':
          setLiveChanges((current) => [...current, event.change]);
          break;
        case 'tool':
          setToolLabel(event.state === 'running' ? (TOOL_LABELS[event.name] ?? 'Đang xử lý…') : '');
          break;
        case 'done':
          requestRef.current = '';
          setStreaming(false);
          setStreamText('');
          setLiveChanges([]);
          setToolLabel('');
          void refreshMessages(event.sessionId);
          void refreshSessions();
          break;
        case 'error':
          requestRef.current = '';
          setStreaming(false);
          setToolLabel('');
          setLiveChanges([]);
          setError(event.message);
          void refreshMessages(event.sessionId);
          void refreshSessions();
          break;
        default:
          break;
      }
    });
    return unsubscribe;
  }, [refreshMessages, refreshSessions]);

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streamText, liveChanges, toolLabel]);

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id !== 'string' || !id) return;
      setOpen(true);
      setStartFresh(false);
      void refreshMessages(id);
    };
    window.addEventListener('evergrow:ai-session', handler);
    return () => window.removeEventListener('evergrow:ai-session', handler);
  }, [refreshMessages]);

  const sendMessage = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    if (!config?.hasKey) {
      setError('Chưa cấu hình API key cho trợ lý.');
      return;
    }
    setInput('');
    setError('');
    setStreaming(true);
    setStreamText('');
    setLiveChanges([]);
    setToolLabel('Đang kết nối…');
    setStartFresh(false);
    const optimistic: AiMessage = {
      id: -Date.now(),
      sessionId: sessionId || 'pending',
      role: 'user',
      content: text,
      createdAt: '',
      changes: [],
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await api.ai.chat({
        sessionId: sessionId || undefined,
        text,
        context: { route: window.location.hash.replace(/^#/, '') },
      });
      requestRef.current = result.requestId;
      sessionRef.current = result.sessionId;
      if (result.sessionId !== sessionId) setSessionId(result.sessionId);
    } catch (err) {
      setStreaming(false);
      setToolLabel('');
      setError(getErrorMessage(err));
      if (sessionId) void refreshMessages(sessionId);
      else setMessages((current) => current.filter((message) => message.id !== optimistic.id));
    }
  };

  const stop = async () => {
    if (!requestRef.current) return;
    try {
      await api.ai.abort(requestRef.current);
    } catch {
      // The request may already be finished.
    }
  };

  const approveChange = async (change: AiChange) => {
    setBusyChange(change.id);
    try {
      await api.ai.approve(change.id);
      toast('Đã áp dụng thay đổi.');
      bump();
      await refreshMessages(sessionRef.current);
      await refreshSessions();
    } catch (err) {
      toast(getErrorMessage(err), 'error');
    } finally {
      setBusyChange(null);
    }
  };

  const rejectChange = async (change: AiChange) => {
    setBusyChange(change.id);
    try {
      await api.ai.reject(change.id);
      toast('Đã từ chối đề xuất.');
      await refreshMessages(sessionRef.current);
      await refreshSessions();
    } catch (err) {
      toast(getErrorMessage(err), 'error');
    } finally {
      setBusyChange(null);
    }
  };

  const approveAll = async (changes: AiChange[]) => {
    setBatchBusy(true);
    let applied = 0;
    try {
      for (const change of changes) {
        try {
          await api.ai.approve(change.id);
          applied += 1;
        } catch (err) {
          toast(getErrorMessage(err), 'error');
          break;
        }
      }
      if (applied > 0) {
        toast(`Đã áp dụng ${applied} thay đổi.`);
        bump();
      }
      await refreshMessages(sessionRef.current);
      await refreshSessions();
    } finally {
      setBatchBusy(false);
    }
  };

  const newChat = () => {
    setStartFresh(true);
    setSessionId('');
    sessionRef.current = '';
    setMessages([]);
    setStreamText('');
    setLiveChanges([]);
    setError('');
    inputRef.current?.focus();
  };

  const persistPanelSize = (size: { width: number; height: number }) => {
    panelSizeRef.current = size;
    try {
      localStorage.setItem('evergrow.ai.panel', JSON.stringify(size));
    } catch {
      // The size is still applied for this session.
    }
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: panelSizeRef.current.width,
      height: panelSizeRef.current.height,
    };
  };

  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeRef.current;
    if (!start) return;
    const next = clampPanelSize(
      start.width + (start.startX - event.clientX),
      start.height + (start.startY - event.clientY),
    );
    panelSizeRef.current = next;
    setPanelSize(next);
  };

  const endResize = () => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    persistPanelSize(panelSizeRef.current);
  };

  const resetPanelSize = () => {
    const next = clampPanelSize(DEFAULT_PANEL_SIZE.width, DEFAULT_PANEL_SIZE.height);
    panelSizeRef.current = next;
    setPanelSize(next);
    persistPanelSize(next);
  };

  useEffect(() => {
    const onResize = () => {
      const next = clampPanelSize(panelSizeRef.current.width, panelSizeRef.current.height);
      panelSizeRef.current = next;
      setPanelSize(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!config || !config.enabled) return null;

  const configured = config.hasKey;
  const showWelcome = messages.length === 0 && !streaming && configured;

  return (
    <>
      <button
        type="button"
        className={`ai-bubble${streaming ? ' busy' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label="Mở trợ lý AI"
        title="Trợ lý AI"
      >
        {streaming ? <LoaderCircle size={20} className="spin" /> : <Bot size={20} />}
      </button>

      {open ? (
        <section
          className="ai-panel"
          aria-label="Trợ lý AI"
          style={
            {
              '--ai-width': `${panelSize.width}px`,
              '--ai-height': `${panelSize.height}px`,
            } as React.CSSProperties
          }
        >
          <header className="ai-panel-head">
            <button
              type="button"
              className="ai-resize"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onDoubleClick={resetPanelSize}
              title="Kéo để đổi kích thước · nhấp đúp để đặt lại"
              aria-label="Đổi kích thước trợ lý"
            >
              <MoveDiagonal2 size={14} />
            </button>
            <div className="ai-panel-title">
              <span className="ai-panel-mark">
                <Sparkles size={15} />
              </span>
              <div>
                <strong>Trợ lý Evergrow</strong>
                <span>
                  {config.model} · {config.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                </span>
              </div>
            </div>
            <div className="ai-panel-actions">
              <button
                type="button"
                className="icon-btn sm"
                onClick={newChat}
                title="Phiên mới"
                aria-label="Phiên mới"
                disabled={streaming}
              >
                <Plus size={15} />
              </button>
              <a
                className="icon-btn sm"
                href="#/assistant"
                title="Lịch sử trợ lý"
                aria-label="Lịch sử trợ lý"
                onClick={() => setOpen(false)}
              >
                <History size={15} />
              </a>
              <button
                type="button"
                className="icon-btn sm"
                onClick={() => setOpen(false)}
                aria-label="Đóng trợ lý"
                title="Đóng"
              >
                <X size={15} />
              </button>
            </div>
          </header>

          <div className="ai-panel-body" ref={listRef}>
            {!configured ? (
              <div className="ai-setup">
                <span className="ai-setup-icon">
                  <Sparkles size={18} />
                </span>
                <strong>Chưa cấu hình trợ lý</strong>
                <p>Thêm API key và chọn model để bắt đầu trò chuyện và chỉnh sửa sổ sách.</p>
                <a className="btn btn-primary btn-sm" href="#/assistant" onClick={() => setOpen(false)}>
                  Mở cài đặt trợ lý
                </a>
              </div>
            ) : null}

            {configured && showWelcome ? (
              <div className="ai-welcome">
                <p>Chào bạn, mình có thể đọc sổ và chuẩn bị thay đổi cho bạn duyệt.</p>
                <div className="ai-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="ai-suggestion"
                      onClick={() => void sendMessage(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className={`ai-msg ai-msg-${message.role}`}>
                <div className="ai-msg-bubble">
                  {message.role === 'assistant' ? <AiMarkdown text={message.content} /> : message.content}
                </div>
                {message.role === 'assistant' && message.changes.length > 0 ? (
                  <MessageChanges
                    changes={message.changes}
                    busyId={busyChange}
                    batchBusy={batchBusy}
                    onApprove={approveChange}
                    onReject={rejectChange}
                    onApproveAll={approveAll}
                    allowActions={!streaming}
                  />
                ) : null}
              </div>
            ))}

            {streaming ? (
              <div className="ai-msg ai-msg-assistant">
                <div className="ai-msg-bubble">
                  {smoothText ? (
                    <>
                      <AiMarkdown text={smoothText} />
                      <span className="ai-cursor" aria-hidden="true" />
                    </>
                  ) : (
                    <AiThinking label={toolLabel || 'Đang suy nghĩ'} />
                  )}
                </div>
                {smoothText && toolLabel ? (
                  <div className="ai-tool">
                    <LoaderCircle size={13} className="spin" />
                    {toolLabel}
                  </div>
                ) : null}
                {liveChanges.length > 0 ? (
                  <MessageChanges
                    changes={liveChanges}
                    busyId={busyChange}
                    batchBusy={batchBusy}
                    onApprove={approveChange}
                    onReject={rejectChange}
                    onApproveAll={approveAll}
                    allowActions={false}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="ai-error">
              <span>{error}</span>
              <button type="button" className="icon-btn sm" onClick={() => setError('')} aria-label="Đóng lỗi">
                <X size={13} />
              </button>
            </div>
          ) : null}

          <form
            className="ai-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <textarea
              ref={inputRef}
              className="ai-input"
              rows={1}
              value={input}
              placeholder={configured ? 'Hỏi trợ lý…' : 'Cấu hình API key để bắt đầu'}
              disabled={!configured || streaming}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            {streaming ? (
              <button type="button" className="icon-btn sm" onClick={stop} title="Dừng" aria-label="Dừng">
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                className="icon-btn sm ai-send"
                disabled={!configured || !input.trim()}
                title="Gửi"
                aria-label="Gửi"
              >
                <Send size={15} />
              </button>
            )}
          </form>
          <div className="ai-foot-note">Trợ lý có thể sai. Mọi thay đổi đều cần bạn duyệt trước khi ghi.</div>
        </section>
      ) : null}
    </>
  );
}
