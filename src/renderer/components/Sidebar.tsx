import {
  ArrowLeftRight,
  Bot,
  ChartColumn,
  Check,
  CircleAlert,
  Container,
  Download,
  Info,
  LayoutDashboard,
  LoaderCircle,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Tags,
  Target,
  WalletCards,
} from 'lucide-react';
import type { UpdateState } from '../../shared/types';
import { LOGO_LEAF, LOGO_WORDMARK } from '../../shared/brand';

const NAV_SECTIONS = [
  {
    label: 'Sổ sách',
    items: [
      { path: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
      { path: '/transactions', label: 'Giao dịch', icon: ArrowLeftRight },
      { path: '/shipments', label: 'Lô hàng', icon: Container },
      { path: '/debts', label: 'Công nợ', icon: WalletCards },
      { path: '/budgets', label: 'Ngân sách', icon: Target },
      { path: '/categories', label: 'Danh mục', icon: Tags },
      { path: '/reports', label: 'Báo cáo', icon: ChartColumn },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { path: '/assistant', label: 'Trợ lý AI', icon: Bot },
      { path: '/appearance', label: 'Giao diện', icon: Palette },
      { path: '/settings', label: 'Cài đặt', icon: Settings },
    ],
  },
];

function updateSummary(state: UpdateState): { label: string; icon: React.ReactNode; tone: string } {
  switch (state.status) {
    case 'checking':
      return { label: 'Đang kiểm tra…', icon: <LoaderCircle size={13} className="spin" />, tone: 'muted' };
    case 'available':
      return { label: `Bản mới v${state.version ?? ''}`, icon: <Download size={13} />, tone: 'accent' };
    case 'downloading':
      return {
        label: `Đang tải ${Math.round(state.percent ?? 0)}%`,
        icon: <LoaderCircle size={13} className="spin" />,
        tone: 'accent',
      };
    case 'downloaded':
      return { label: 'Bản mới sẵn sàng', icon: <Download size={13} />, tone: 'accent' };
    case 'up-to-date':
      return { label: 'Đã là bản mới nhất', icon: <Check size={13} />, tone: 'ok' };
    case 'error':
      return { label: 'Cập nhật gặp lỗi', icon: <CircleAlert size={13} />, tone: 'danger' };
    case 'unsupported':
      return { label: 'Bản phát triển', icon: <Info size={13} />, tone: 'muted' };
    default:
      return { label: 'Kiểm tra cập nhật', icon: <RefreshCw size={13} />, tone: 'muted' };
  }
}

export function Sidebar({
  path,
  companyName,
  version,
  updateState,
  collapsed,
  onToggle,
}: {
  path: string;
  companyName: string;
  version: string;
  updateState: UpdateState;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const update = updateSummary(updateState);
  const initial = companyName.trim().charAt(0).toUpperCase() || 'E';

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        {collapsed ? (
          <button
            type="button"
            className="brand brand-collapsed"
            onClick={onToggle}
            aria-label="Mở rộng thanh điều hướng"
            title="Mở rộng thanh điều hướng"
          >
            <img className="brand-leaf" src={LOGO_LEAF} alt="Evergrow" />
            <span className="brand-expand" aria-hidden="true">
              <PanelLeftOpen size={17} />
            </span>
          </button>
        ) : (
          <>
            <a className="brand" href="#/dashboard">
              <img className="brand-leaf" src={LOGO_LEAF} alt="" />
              <span className="brand-text">
                <img className="brand-wordmark" src={LOGO_WORDMARK} alt="Evergrow" />
                <span className="brand-sub">Sổ thu chi</span>
              </span>
            </a>
            <button
              type="button"
              className="sidebar-toggle"
              onClick={onToggle}
              aria-label="Thu gọn thanh điều hướng"
              aria-expanded="true"
              title="Thu gọn thanh điều hướng"
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      <nav className="nav" aria-label="Điều hướng chính">
        {NAV_SECTIONS.map((section) => (
          <div className="nav-section" key={section.label}>
            <span className="nav-section-label">{section.label}</span>
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = path === item.path;
              return (
                <a
                  key={item.path}
                  href={`#${item.path}`}
                  className={`nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={17} strokeWidth={active ? 2 : 1.8} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <a
          href="#/settings"
          className={`update-chip tone-${update.tone}`}
          title={collapsed ? update.label : undefined}
        >
          {update.icon}
          <span>{update.label}</span>
        </a>
        <div className="company-card" title={collapsed ? companyName : undefined}>
          <span className="company-mark">{initial}</span>
          <div className="company-meta">
            <span className="company-label">Công ty</span>
            <span className="company-name" title={companyName}>
              {companyName}
            </span>
          </div>
        </div>
        <div className="sidebar-version">v{version} · SQLite cục bộ</div>
      </div>
    </aside>
  );
}
