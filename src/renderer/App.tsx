import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeSettings } from '../shared/theme';
import type { AppMeta, Transaction, UpdateState } from '../shared/types';
import { AppContext } from './context';
import { api, getErrorMessage } from './api';
import { applyTheme, cacheTheme, readCachedTheme } from './theme';
import { useHashRoute, type Route } from './hooks';
import { useToast } from './components/toast';
import { Sidebar } from './components/Sidebar';
import { TransactionModal } from './components/TransactionModal';
import { DashboardPage } from './pages/Dashboard';
import { TransactionsPage } from './pages/Transactions';
import { ShipmentsPage } from './pages/Shipments';
import { DebtsPage } from './pages/Debts';
import { BudgetsPage } from './pages/Budgets';
import { CategoriesPage } from './pages/Categories';
import { ReportsPage } from './pages/Reports';
import { AppearancePage } from './pages/Appearance';
import { SettingsPage } from './pages/Settings';
import { PrintReport } from './pages/PrintReport';

export function App() {
  const route = useHashRoute();
  if (route.path === '/print') return <PrintReport params={route.params} />;
  return <Shell route={route} />;
}

function Shell({ route }: { route: Route }) {
  const toast = useToast();
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [companyName, setCompanyName] = useState('Công ty của bạn');
  const [theme, setTheme] = useState<ThemeSettings>(readCachedTheme);
  const [revision, setRevision] = useState(0);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarState);
  const [modal, setModal] = useState<{ transaction: Transaction | null } | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem('evergrow.sidebar', next ? 'collapsed' : 'expanded');
      } catch {
        // localStorage can be unavailable in restricted windows
      }
      return next;
    });
  }, []);

  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const openTransaction = useCallback(
    (transaction?: Transaction) => setModal({ transaction: transaction ?? null }),
    [],
  );
  const reloadSettings = useCallback(async () => {
    const settings = await api.settings.get();
    setCompanyName(settings.companyName);
  }, []);

  useEffect(() => {
    api.getMeta().then(setMeta).catch((error) => toast(getErrorMessage(error), 'error'));
    reloadSettings().catch((error) => toast(getErrorMessage(error), 'error'));
    api.theme
      .get()
      .then((saved) => {
        setTheme(saved);
        applyTheme(saved);
        cacheTheme(saved);
      })
      .catch((error) => toast(getErrorMessage(error), 'error'));
  }, [reloadSettings, toast]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const previewTheme = useCallback((next: ThemeSettings) => {
    applyTheme(next);
  }, []);

  const saveTheme = useCallback(async (next: ThemeSettings) => {
    const saved = await api.theme.save(next);
    setTheme(saved);
    applyTheme(saved);
    cacheTheme(saved);
    return saved;
  }, []);

  useEffect(() => {
    let alive = true;
    api.updater
      .getState()
      .then((state) => {
        if (alive) setUpdateState(state);
      })
      .catch(() => undefined);
    const unsubscribe = api.updater.onState((state) => setUpdateState(state));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route.path]);

  const context = useMemo(
    () => ({
      meta,
      companyName,
      theme,
      revision,
      updateState,
      bump,
      reloadSettings,
      previewTheme,
      saveTheme,
      openTransaction,
    }),
    [
      meta,
      companyName,
      theme,
      revision,
      updateState,
      bump,
      reloadSettings,
      previewTheme,
      saveTheme,
      openTransaction,
    ],
  );

  return (
    <AppContext.Provider value={context}>
      <div className={`shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="titlebar-drag" />
        <Sidebar
          path={route.path}
          companyName={companyName}
          version={meta?.version ?? '1.0.0'}
          updateState={updateState}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
        <main className="main" ref={mainRef}>
          <div className="main-inner">{renderPage(route.path)}</div>
        </main>
      </div>
      {modal ? (
        <TransactionModal
          transaction={modal.transaction}
          onClose={() => {
            setModal(null);
            bump();
          }}
          onSaved={() => {
            setModal(null);
            bump();
          }}
        />
      ) : null}
    </AppContext.Provider>
  );
}

function readSidebarState(): boolean {
  try {
    return localStorage.getItem('evergrow.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function renderPage(path: string) {
  switch (path) {
    case '/transactions':
      return <TransactionsPage />;
    case '/shipments':
      return <ShipmentsPage />;
    case '/debts':
      return <DebtsPage />;
    case '/budgets':
      return <BudgetsPage />;
    case '/categories':
      return <CategoriesPage />;
    case '/reports':
      return <ReportsPage />;
    case '/appearance':
      return <AppearancePage />;
    case '/settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}
