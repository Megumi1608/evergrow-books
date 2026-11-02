import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Palette, RotateCcw } from 'lucide-react';
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  cloneTheme,
  getThemePreset,
  themesEqual,
  type ThemeColorKey,
  type ThemePreset,
  type ThemeSettings,
} from '../../shared/theme';
import { LOGO_LEAF, LOGO_WORDMARK } from '../../shared/brand';
import { getErrorMessage } from '../api';
import { useApp } from '../context';
import { applyTheme } from '../theme';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/ui';

const LAYOUT_COLORS: { key: ThemeColorKey; label: string; hint: string }[] = [
  { key: 'bg', label: 'Nền trang', hint: 'Màu nền chung' },
  { key: 'surface', label: 'Bề mặt thẻ', hint: 'Bảng, thẻ, modal' },
  { key: 'surfaceMuted', label: 'Nền phụ', hint: 'Sidebar, vùng chọn' },
  { key: 'ink', label: 'Chữ chính', hint: 'Tiêu đề, nội dung' },
  { key: 'inkSoft', label: 'Chữ phụ', hint: 'Nhãn, mô tả' },
  { key: 'muted', label: 'Chữ mờ', hint: 'Ghi chú, trạng thái' },
  { key: 'line', label: 'Đường viền', hint: 'Phân cách nhẹ' },
  { key: 'lineStrong', label: 'Viền đậm', hint: 'Input, nút viền' },
];

const SEMANTIC_COLORS: { key: ThemeColorKey; label: string; hint: string }[] = [
  { key: 'income', label: 'Thu nhập', hint: 'Số tiền thu, trạng thái tốt' },
  { key: 'expense', label: 'Chi phí', hint: 'Số tiền chi, lỗi' },
  { key: 'warning', label: 'Cảnh báo', hint: 'Cập nhật, lưu ý' },
];

function swatchColors(preset: ThemePreset): string[] {
  return [
    preset.colors.bg,
    preset.colors.surface,
    preset.colors.ink,
    preset.colors.income,
    preset.colors.expense,
    preset.colors.warning,
  ];
}

export function AppearancePage() {
  const { theme, previewTheme, saveTheme } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<ThemeSettings>(() => cloneTheme(theme));
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(theme);

  useEffect(() => {
    savedRef.current = theme;
  }, [theme]);

  useEffect(() => {
    previewTheme(draft);
  }, [draft, previewTheme]);

  useEffect(() => {
    return () => applyTheme(savedRef.current);
  }, []);

  const dirty = !themesEqual(draft, theme);
  const activePreset = getThemePreset(draft.preset);

  const applyPreset = (preset: ThemePreset) => {
    setDraft({ preset: preset.id, colors: { ...preset.colors } });
  };

  const setColor = (key: ThemeColorKey, value: string) => {
    setDraft((current) => ({
      preset: 'custom',
      colors: { ...current.colors, [key]: value.toUpperCase() },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveTheme(draft);
      setDraft(cloneTheme(saved));
      savedRef.current = saved;
      toast('Đã lưu giao diện.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(cloneTheme(DEFAULT_THEME));
  };

  return (
    <div className="page">
      <PageHeader
        title="Giao diện"
        subtitle="Bảng màu tối giản; chỉ số liệu và trạng thái đặc biệt được dùng màu."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              <RotateCcw size={15} />
              Đặt lại Mono
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
              Lưu thay đổi
            </button>
          </>
        }
      />

      <div className="appearance-grid">
        <div className="appearance-col">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Bộ màu có sẵn</h2>
                <p>Áp dụng ngay để xem trước; bấm Lưu để giữ lại.</p>
              </div>
              {dirty ? <span className="version-pill warning-pill">Chưa lưu</span> : null}
            </div>
            <div className="preset-grid">
              {THEME_PRESETS.map((preset) => {
                const selected = draft.preset === preset.id;
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={`preset${selected ? ' selected' : ''}`}
                    onClick={() => applyPreset(preset)}
                  >
                    <span className="preset-swatches">
                      {swatchColors(preset).map((color, index) => (
                        <i key={`${preset.id}-${index}`} style={{ background: color }} />
                      ))}
                    </span>
                    <span className="preset-name">
                      {preset.name}
                      {selected ? <Check size={13} /> : null}
                    </span>
                    <span className="preset-desc">{preset.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Màu nền &amp; chữ</h2>
                <p>Giữ tương phản cao giữa nền và nội dung.</p>
              </div>
            </div>
            <div className="color-grid">
              {LAYOUT_COLORS.map((item) => (
                <ColorField
                  key={item.key}
                  label={item.label}
                  hint={item.hint}
                  colorKey={item.key}
                  value={draft.colors[item.key]}
                  onChange={setColor}
                />
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Màu nhấn</h2>
                <p>Chỉ dùng cho số tiền, cảnh báo và trạng thái.</p>
              </div>
            </div>
            <div className="color-grid color-grid-3">
              {SEMANTIC_COLORS.map((item) => (
                <ColorField
                  key={item.key}
                  label={item.label}
                  hint={item.hint}
                  colorKey={item.key}
                  value={draft.colors[item.key]}
                  onChange={setColor}
                />
              ))}
            </div>
          </section>
        </div>

        <div className="appearance-col">
          <section className="card theme-preview-card">
            <div className="card-head">
              <div>
                <h2>Xem trước trực tiếp</h2>
                <p>{activePreset ? activePreset.name : 'Bộ màu tuỳ chỉnh'}</p>
              </div>
              <Palette size={17} className="card-icon" />
            </div>
            <div className="theme-preview">
              <aside className="preview-sidebar">
                <div className="preview-brand">
                  <img src={LOGO_LEAF} alt="" />
                  <img src={LOGO_WORDMARK} alt="Evergrow" />
                </div>
                <span className="preview-nav active">Tổng quan</span>
                <span className="preview-nav">Giao dịch</span>
                <span className="preview-nav">Báo cáo</span>
                <span className="preview-chip">Bản mới sẵn sàng</span>
              </aside>
              <div className="preview-main">
                <div className="preview-head">
                  <strong>Tổng quan</strong>
                  <span className="btn btn-primary btn-sm">Thêm giao dịch</span>
                </div>
                <div className="preview-kpis">
                  <div>
                    <span>Thu nhập</span>
                    <strong className="income">245.700.000 đ</strong>
                  </div>
                  <div>
                    <span>Chi phí</span>
                    <strong className="expense">166.900.000 đ</strong>
                  </div>
                  <div>
                    <span>Chênh lệch</span>
                    <strong className="warning">+78.800.000 đ</strong>
                  </div>
                </div>
                <div className="preview-chart">
                  {[34, 58, 42, 72, 66, 48].map((height, index) => (
                    <span key={index} className="preview-bar-group">
                      <i className="income" style={{ height: `${height}%` }} />
                      <i className="expense" style={{ height: `${height * 0.62}%` }} />
                    </span>
                  ))}
                </div>
                <p className="preview-note">
                  Phần giao diện giữ trắng đen. Xanh, đỏ, vàng chỉ dành cho số liệu và trạng thái đặc biệt.
                </p>
              </div>
            </div>
            <p className="hint">Logo giữ nguyên màu thương hiệu; ở nền tối logo tự chuyển sang trắng.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  hint,
  colorKey,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  colorKey: ThemeColorKey;
  value: string;
  onChange: (key: ThemeColorKey, value: string) => void;
}) {
  return (
    <label className="color-field" htmlFor={`color-${colorKey}`}>
      <span className="color-label">
        <strong>{label}</strong>
        <span>{hint}</span>
      </span>
      <span className="color-control">
        <input
          id={`color-${colorKey}`}
          type="color"
          value={value}
          onChange={(event) => onChange(colorKey, event.target.value)}
        />
        <code>{value.toUpperCase()}</code>
      </span>
    </label>
  );
}
