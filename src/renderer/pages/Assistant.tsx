import { useEffect, useState } from 'react';
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  History,
  KeyRound,
  LoaderCircle,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AiChange, AiConfig, AiProvider, AiSessionSummary, AiTestResult } from '../../shared/types';
import { formatDate } from '../../shared/dates';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { AiChangeCard } from '../components/AiChangeCard';
import { useToast } from '../components/toast';
import { Checkbox, ConfirmDialog, Dropdown, EmptyState, PageHeader } from '../components/ui';

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI-compatible' },
  { value: 'anthropic', label: 'Anthropic-compatible' },
];

const PROVIDER_DEFAULTS: Record<AiProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
};

interface ConfigForm {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  temperature: string;
  enabled: boolean;
}

export function AssistantPage() {
  const { revision, bump } = useApp();
  const toast = useToast();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [form, setForm] = useState<ConfigForm>({
    provider: 'openai',
    baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
    model: PROVIDER_DEFAULTS.openai.model,
    temperature: '0.2',
    enabled: true,
  });
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [changes, setChanges] = useState<AiChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [revertTarget, setRevertTarget] = useState<AiChange | null>(null);
  const [sessionRevertOpen, setSessionRevertOpen] = useState(false);
  const [busyChange, setBusyChange] = useState<number | null>(null);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    let alive = true;
    api.ai
      .config()
      .then((saved) => {
        if (!alive) return;
        setConfig(saved);
        setForm({
          provider: saved.provider,
          baseUrl: saved.baseUrl,
          model: saved.model,
          temperature: String(saved.temperature),
          enabled: saved.enabled,
        });
      })
      .catch((error) => {
        if (alive) toast(getErrorMessage(error), 'error');
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  useEffect(() => {
    let alive = true;
    api.ai
      .sessions()
      .then((list) => {
        if (alive) setSessions(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [revision]);

  useEffect(() => {
    if (selectedSession || sessions.length === 0) return;
    setSelectedSession(sessions[0].id);
  }, [selectedSession, sessions]);

  useEffect(() => {
    if (!selectedSession) {
      setChanges([]);
      return;
    }
    let alive = true;
    setLoadingChanges(true);
    api.ai
      .changes(selectedSession)
      .then((list) => {
        if (alive) setChanges(list);
      })
      .catch((error) => {
        if (alive) toast(getErrorMessage(error), 'error');
      })
      .finally(() => {
        if (alive) setLoadingChanges(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedSession, revision, toast]);

  const changeProvider = (provider: AiProvider) => {
    setForm((current) => {
      const previousDefault = PROVIDER_DEFAULTS[current.provider];
      const nextDefault = PROVIDER_DEFAULTS[provider];
      return {
        ...current,
        provider,
        baseUrl:
          !current.baseUrl || current.baseUrl === previousDefault.baseUrl
            ? nextDefault.baseUrl
            : current.baseUrl,
        model:
          !current.model || current.model === previousDefault.model ? nextDefault.model : current.model,
      };
    });
  };

  const saveConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setTestResult(null);
    try {
      const saved = await api.ai.saveConfig({
        provider: form.provider,
        baseUrl: form.baseUrl,
        model: form.model,
        temperature: Number(form.temperature),
        enabled: form.enabled,
        apiKey: apiKey.trim() || undefined,
      });
      setConfig(saved);
      setApiKey('');
      setForm({
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
        temperature: String(saved.temperature),
        enabled: saved.enabled,
      });
      window.dispatchEvent(new Event('evergrow:ai-config'));
      toast('Đã lưu cấu hình trợ lý.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    try {
      const saved = await api.ai.clearKey();
      setConfig(saved);
      setApiKey('');
      setTestResult(null);
      window.dispatchEvent(new Event('evergrow:ai-config'));
      toast('Đã xoá API key.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.ai.test());
    } catch (error) {
      setTestResult({ ok: false, message: getErrorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  const openSession = (id: string) => {
    window.dispatchEvent(new CustomEvent('evergrow:ai-session', { detail: id }));
  };

  const revertChange = async () => {
    if (!revertTarget) return;
    setReverting(true);
    setBusyChange(revertTarget.id);
    try {
      await api.ai.revertChange(revertTarget.id);
      toast('Đã hoàn tác thay đổi.');
      setRevertTarget(null);
      bump();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setReverting(false);
      setBusyChange(null);
    }
  };

  const revertSession = async () => {
    if (!selectedSession) return;
    setReverting(true);
    try {
      const result = await api.ai.revertSession(selectedSession);
      if (result.reverted > 0) {
        bump();
      }
      toast(result.message, result.conflictId ? 'error' : undefined);
      setSessionRevertOpen(false);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setReverting(false);
    }
  };

  const selected = sessions.find((session) => session.id === selectedSession);
  const hasApproved = changes.some((change) => change.status === 'approved');

  return (
    <div className="page">
      <PageHeader
        title="Trợ lý AI"
        subtitle="Cấu hình kết nối, xem lại phiên trò chuyện và hoàn tác thay đổi."
      />

      <div className="assistant-grid">
        <section className="card assistant-card">
          <div className="card-head">
            <div>
              <h2>Kết nối AI</h2>
              <p>API key được mã hoá bằng tài khoản Windows và chỉ dùng ở tiến trình chính.</p>
            </div>
            <span className={`ai-label${config?.hasKey ? ' ok' : ''}`}>
              {config?.hasKey ? 'Đã có API key' : 'Chưa có API key'}
            </span>
          </div>

          <form className="assistant-form" onSubmit={saveConfig}>
            <div className="form-row">
              <label className="field">
                <span className="field-label">Nhà cung cấp</span>
                <Dropdown
                  value={form.provider}
                  onChange={changeProvider}
                  options={PROVIDER_OPTIONS}
                  size="md"
                  ariaLabel="Nhà cung cấp AI"
                />
              </label>
              <label className="field">
                <span className="field-label">Temperature</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={form.temperature}
                  onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))}
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">Base URL</span>
              <input
                className="input"
                value={form.baseUrl}
                placeholder={PROVIDER_DEFAULTS[form.provider].baseUrl}
                onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
              />
              <span className="hint no-pad">
                Dùng HTTPS, hoặc HTTP với localhost (Ollama, LM Studio). Có thể nhập URL proxy.
              </span>
            </label>

            <label className="field">
              <span className="field-label">Model</span>
              <input
                className="input"
                value={form.model}
                placeholder={PROVIDER_DEFAULTS[form.provider].model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
              />
            </label>

            <label className="field">
              <span className="field-label">API key</span>
              <span className="amount-wrap">
                <input
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={config?.hasKey ? `Đã lưu ••••${config.keyHint}` : 'Nhập API key'}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn sm ai-key-toggle"
                  onClick={() => setShowKey((value) => !value)}
                  aria-label={showKey ? 'Ẩn API key' : 'Hiện API key'}
                  title={showKey ? 'Ẩn API key' : 'Hiện API key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
              <span className="hint no-pad">
                Để trống nếu không đổi key. Key hiện tại không bao giờ được gửi lại giao diện.
              </span>
            </label>

            <div className="assistant-inline">
              <Checkbox
                checked={form.enabled}
                onChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
                label="Hiện bubble trợ lý"
                description="Tắt để ẩn bubble trong toàn bộ ứng dụng."
              />
              {config?.hasKey ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearKey}>
                  <KeyRound size={13} />
                  Xoá API key
                </button>
              ) : null}
            </div>

            {testResult ? (
              <div className={`ai-test${testResult.ok ? ' ok' : ' error'}`}>
                {testResult.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                <span>{testResult.message}</span>
              </div>
            ) : null}

            <div className="assistant-actions">
              <button type="button" className="btn btn-outline" onClick={testConnection} disabled={testing || !config?.hasKey}>
                {testing ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                Kiểm tra kết nối
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
                Lưu cấu hình
              </button>
            </div>
          </form>

          <div className="ai-privacy">
            <ShieldCheck size={15} />
            <p>
              Khi trò chuyện, dữ liệu liên quan (giao dịch, phí, đối tác) được gửi tới nhà cung cấp AI
              bạn cấu hình. Không có telemetry; API key chỉ lưu trên máy này.
            </p>
          </div>
        </section>

        <section className="card assistant-card assistant-history">
          <div className="card-head">
            <div>
              <h2>Phiên & thay đổi</h2>
              <p>Mỗi phiên lưu bản sao trước/sau để hoàn tác.</p>
            </div>
            <span className="card-total">{sessions.length} phiên</span>
          </div>

          {sessions.length === 0 ? (
            <div className="assistant-empty">
              <EmptyState
                icon={<Bot size={22} />}
                title="Chưa có phiên trò chuyện"
                description="Mở bubble trợ lý và gửi câu hỏi đầu tiên."
              />
            </div>
          ) : (
            <div className="ai-session-list">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`ai-session-row${session.id === selectedSession ? ' active' : ''}`}
                  onClick={() => setSelectedSession(session.id)}
                >
                  <div className="ai-session-info">
                    <strong>{session.title || 'Phiên mới'}</strong>
                    <span>
                      {formatDate(session.updatedAt.slice(0, 10))} · {session.messageCount} tin nhắn
                    </span>
                  </div>
                  <span className="ai-session-count">{session.changeCount} thay đổi</span>
                </button>
              ))}
            </div>
          )}

          {selected ? (
            <div className="ai-history-detail">
              <div className="ai-history-head">
                <div>
                  <strong>{selected.title || 'Phiên mới'}</strong>
                  <span>
                    {selected.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {selected.model}
                  </span>
                </div>
                <div className="ai-history-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => openSession(selected.id)}
                  >
                    <History size={14} />
                    Mở trong trợ lý
                  </button>
                  {hasApproved ? (
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm"
                      onClick={() => setSessionRevertOpen(true)}
                    >
                      <RotateCcw size={14} />
                      Hoàn tác cả phiên
                    </button>
                  ) : null}
                </div>
              </div>

              {loadingChanges ? (
                <div className="ai-history-loading">
                  <LoaderCircle size={16} className="spin" />
                  Đang tải thay đổi…
                </div>
              ) : changes.length === 0 ? (
                <p className="hint no-pad">Phiên này chưa có thay đổi nào được đề xuất.</p>
              ) : (
                <div className="ai-history-changes">
                  {changes.map((change) => (
                    <AiChangeCard
                      key={change.id}
                      change={change}
                      mode="history"
                      busy={busyChange === change.id}
                      onRevert={() => setRevertTarget(change)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {revertTarget ? (
        <ConfirmDialog
          title="Hoàn tác thay đổi?"
          description={
            <>
              Thay đổi <strong>{revertTarget.summary}</strong> sẽ được khôi phục về trạng thái trước khi
              trợ lý áp dụng. Nếu dòng đã bị sửa sau đó, thao tác sẽ bị chặn.
            </>
          }
          confirmLabel="Hoàn tác"
          danger
          busy={reverting}
          onClose={() => setRevertTarget(null)}
          onConfirm={() => void revertChange()}
        />
      ) : null}

      {sessionRevertOpen ? (
        <ConfirmDialog
          title="Hoàn tác cả phiên?"
          description={
            <>
              Tất cả thay đổi đã áp dụng trong phiên <strong>{selected?.title || 'này'}</strong> sẽ được
              hoàn tác theo thứ tự ngược. Thao tác dừng lại nếu gặp dòng đã bị sửa.
            </>
          }
          confirmLabel="Hoàn tác phiên"
          danger
          busy={reverting}
          onClose={() => setSessionRevertOpen(false)}
          onConfirm={() => void revertSession()}
        />
      ) : null}
    </div>
  );
}
