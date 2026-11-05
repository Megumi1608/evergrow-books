import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, LoaderCircle, X } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Xác nhận',
  danger = false,
  requireText,
  busy = false,
  onClose,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const confirmed = !requireText || value === requireText;

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={!confirmed || busy}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        <p>{description}</p>
        {requireText ? (
          <label className="field">
            <span className="field-label">
              Nhập <strong>{requireText}</strong> để xác nhận
            </span>
            <input
              ref={inputRef}
              className="input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segment${value === option.value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface DropdownGroup<T extends string | number> {
  label?: string;
  options: DropdownOption<T>[];
}

export function Dropdown<T extends string | number>({
  value,
  onChange,
  options,
  groups,
  ariaLabel,
  className = '',
  placeholder = 'Chọn…',
  disabled = false,
  size = 'sm',
}: {
  value: T;
  onChange: (value: T) => void;
  options?: DropdownOption<T>[];
  groups?: DropdownGroup<T>[];
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 180 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();

  const flat = groups ? groups.flatMap((group) => group.options) : (options ?? []);
  const selected = flat.find((option) => option.value === value);

  const firstEnabled = () => flat.findIndex((option) => !option.disabled);
  const lastEnabled = () => {
    for (let index = flat.length - 1; index >= 0; index -= 1) {
      if (!flat[index].disabled) return index;
    }
    return -1;
  };

  const openMenu = () => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + 6,
        left: Math.max(8, rect.left),
        width: Math.max(rect.width, 180),
      });
    }
    const selectedIndex = flat.findIndex((option) => option.value === value);
    setActive(selectedIndex >= 0 && !flat[selectedIndex].disabled ? selectedIndex : firstEnabled());
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = flat[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (delta: 1 | -1) => {
    if (flat.length === 0) return;
    let next = active;
    for (let step = 0; step < flat.length; step += 1) {
      next = (next + delta + flat.length) % flat.length;
      if (!flat[next].disabled) {
        setActive(next);
        return;
      }
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(firstEnabled());
        break;
      case 'End':
        event.preventDefault();
        setActive(lastEnabled());
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!rect || !menu) return;
    const height = menu.offsetHeight;
    const width = Math.max(rect.width, 180);
    const openUp = rect.bottom + 6 + height > window.innerHeight - 10 && rect.top - height - 6 > 10;
    setMenuPos({
      top: openUp ? rect.top - height - 6 : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 10)),
      width,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const renderOption = (option: DropdownOption<T>, index: number) => (
    <button
      key={`${option.value}`}
      id={`${listId}-${index}`}
      ref={(element) => {
        optionRefs.current[index] = element;
      }}
      type="button"
      role="option"
      aria-selected={option.value === value}
      aria-disabled={option.disabled || undefined}
      tabIndex={-1}
      className={`dropdown-option${option.value === value ? ' selected' : ''}${
        index === active ? ' active' : ''
      }${option.disabled ? ' disabled' : ''}`}
      onMouseDown={(event) => {
        event.preventDefault();
        choose(index);
      }}
      onMouseEnter={() => {
        if (!option.disabled) setActive(index);
      }}
    >
      <span title={option.label}>{option.label}</span>
      {option.value === value ? <Check size={13} /> : null}
    </button>
  );

  return (
    <span className={`dropdown${open ? ' open' : ''} ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger ${size}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`dropdown-value${selected ? '' : ' placeholder'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className="dropdown-chevron" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              className="dropdown-menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            >
              {groups
                ? groups.map((group, groupIndex) => {
                    if (group.options.length === 0) return null;
                    return (
                      <div className="dropdown-group" key={`${group.label ?? 'group'}-${groupIndex}`}>
                        {group.label ? <span className="dropdown-group-label">{group.label}</span> : null}
                        {group.options.map((option) => renderOption(option, flat.indexOf(option)))}
                      </div>
                    );
                  })
                : (options ?? []).map((option, index) => renderOption(option, index))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <label className={`check-row${disabled ? ' disabled' : ''}`}>
      <input
        type="checkbox"
        className="check-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-box" aria-hidden="true">
        <Check size={12} strokeWidth={3} />
      </span>
      {label || description ? (
        <span className="check-text">
          {label ? <strong>{label}</strong> : null}
          {description ? <small>{description}</small> : null}
        </span>
      ) : null}
    </label>
  );
}

export function DateInput({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className={`date-wrap ${className}`}>
      <input ref={ref} {...props} type="date" className="input" />
      <button
        type="button"
        className="date-trigger"
        tabIndex={-1}
        aria-label="Chọn ngày"
        disabled={props.disabled}
        onClick={() => {
          const input = ref.current;
          if (!input) return;
          input.focus();
          try {
            (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            // Some builds do not allow showPicker on a focused date input.
          }
        }}
      >
        <CalendarDays size={14} />
      </button>
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  foot,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  foot?: ReactNode;
  tone?: 'neutral' | 'income' | 'expense' | 'net' | 'warning';
  icon?: ReactNode;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon ? <span className="kpi-icon">{icon}</span> : null}
      </div>
      <div className="kpi-value">{value}</div>
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="page-loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-sub" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-block" />
    </div>
  );
}
