import {
  ArrowLeftRight,
  ChartColumn,
  Check,
  CircleAlert,
  Download,
  Info,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Settings,
  Tags,
} from 'lucide-react';
import type { UpdateState } from '../../shared/types';
import { Logo } from './ui';

const NAV = [
  { path: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { path: '/transactions', label: 'Giao dịch', icon: ArrowLeftRight },
  { path: '/categories', label: 'Danh mục', icon: Tags },
  { path: '/reports', label: 'Báo cáo', icon: ChartColumn },
  { path: '/settings', label: 'Cài đặt', icon: Settings },
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
      return { label: 'Đã là bản mới nhất', icon: <Check size={13} />, tone: 'muted' };
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
}: {
  path: string;
  companyName: string;
  version: string;
  updateState: UpdateState;
}) {
  const update = updateSummary(updateState);
  const initial = companyName.trim().charAt(0).toUpperCase() || 'E';

  return (
    <aside className="sidebar">
      <a className="brand" href="#/dashboard">
        <Logo />
        <span className="brand-text">
          <span className="brand-name">Evergrow</span>
          <span className="brand-sub">Sổ thu chi</span>
        </span>
      </a>

      <nav className="nav" aria-label="Điều hướng chính">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = path === item.path;
          return (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={17} strokeWidth={active ? 2 : 1.8} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <a href="#/settings" className={`update-chip tone-${update.tone}`}>
          {update.icon}
          <span>{update.label}</span>
        </a>
        <div className="company-card">
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
