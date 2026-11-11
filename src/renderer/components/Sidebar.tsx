import { useRef, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import {
  Check,
  CircleAlert,
  Download,
  Info,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react';
import {
  BotIcon,
  ChartColumnIncreasingIcon,
  ChevronsLeftRightIcon,
  GaugeIcon,
  HomeIcon,
  LayersIcon,
  SettingsIcon,
  ShipIcon,
  SunMoonIcon,
  WalletIcon,
} from 'lucide-animated';
import type { UpdateState } from '../../shared/types';
import { LOGO_LEAF, LOGO_WORDMARK } from '../../shared/brand';

interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type AnimatedIcon = ForwardRefExoticComponent<
  { size?: number; animateOnHover?: boolean; className?: string } & RefAttributes<AnimatedIconHandle>
>;

interface NavEntry {
  path: string;
  label: string;
  icon: AnimatedIcon;
}

const NAV_SECTIONS: { label: string; items: NavEntry[] }[] = [
  {
    label: 'Sổ sách',
    items: [
      { path: '/dashboard', label: 'Tổng quan', icon: HomeIcon },
      { path: '/transactions', label: 'Giao dịch', icon: ChevronsLeftRightIcon },
      { path: '/shipments', label: 'Lô hàng', icon: ShipIcon },
      { path: '/debts', label: 'Công nợ', icon: WalletIcon },
      { path: '/budgets', label: 'Ngân sách', icon: GaugeIcon },
      { path: '/categories', label: 'Danh mục', icon: LayersIcon },
      { path: '/reports', label: 'Báo cáo', icon: ChartColumnIncreasingIcon },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { path: '/assistant', label: 'Trợ lý AI', icon: BotIcon },
      { path: '/appearance', label: 'Giao diện', icon: SunMoonIcon },
      { path: '/settings', label: 'Cài đặt', icon: SettingsIcon },
    ],
  },
];

function NavItem({
  item,
  active,
  collapsed,
}: {
  item: NavEntry;
  active: boolean;
  collapsed: boolean;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const Icon = item.icon;
  return (
    <a
      href={`#${item.path}`}
      className={`nav-item${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      onFocus={() => iconRef.current?.startAnimation()}
      onBlur={() => iconRef.current?.stopAnimation()}
    >
      <Icon ref={iconRef} size={17} animateOnHover={false} className="nav-item-icon" />
      <span>{item.label}</span>
    </a>
  );
}

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
            {section.items.map((item) => (
              <NavItem
                key={item.path}
                item={item}
                active={path === item.path}
                collapsed={collapsed}
              />
            ))}
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
