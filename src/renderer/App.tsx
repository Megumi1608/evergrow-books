import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppMeta, Transaction, UpdateState } from '../shared/types';
import { AppContext } from './context';
import { api, getErrorMessage } from './api';
import { useHashRoute, type Route } from './hooks';
import { useToast } from './components/toast';
import { Sidebar } from './components/Sidebar';
import { TransactionModal } from './components/TransactionModal';
import { DashboardPage } from './pages/Dashboard';
import { TransactionsPage } from './pages/Transactions';
import { CategoriesPage } from './pages/Categories';
import { ReportsPage } from './pages/Reports';
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
  const [revision, setRevision] = useState(0);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [modal, setModal] = useState<{ transaction: Transaction | null } | null>(null);
  const mainRef = useRef<HTMLElement>(null);

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
  }, [reloadSettings, toast]);

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
      revision,
      updateState,
      bump,
      reloadSettings,
      openTransaction,
    }),
    [meta, companyName, revision, updateState, bump, reloadSettings, openTransaction],
  );

  return (
    <AppContext.Provider value={context}>
      <div className="shell">
        <div className="titlebar-drag" />
        <Sidebar
          path={route.path}
          companyName={companyName}
          version={meta?.version ?? '1.0.0'}
          updateState={updateState}
        />
        <main className="main" ref={mainRef}>
          <div className="main-inner">{renderPage(route.path)}</div>
        </main>
      </div>
      {modal ? (
        <TransactionModal
          transaction={modal.transaction}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            bump();
          }}
        />
      ) : null}
    </AppContext.Provider>
  );
}

function renderPage(path: string) {
  switch (path) {
    case '/transactions':
      return <TransactionsPage />;
    case '/categories':
      return <CategoriesPage />;
    case '/reports':
      return <ReportsPage />;
    case '/settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}
