import React from 'react';
import AppShell from './components/app/AppShell';
import { useAppController, type AppControllerProps } from './hooks/useAppController';
import { resolveAppRoute } from './cad-app/cadNavigation';
import StudyApp from './study/StudyApp';

const CadApp = React.lazy(() => import('./cad-app/CadApp'));

const AdjustmentApp: React.FC<AppControllerProps> = (props) => {
  const controller = useAppController(props);
  return <AppShell controller={controller} />;
};

const App: React.FC<AppControllerProps> = (props) => {
  if (typeof window === 'undefined') return <AdjustmentApp {...props} />;
  const route = resolveAppRoute(window.location.pathname);
  if (route === 'study') return <StudyApp />;
  if (route === 'cad') {
    return (
      <React.Suspense
        fallback={
          <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-sm text-slate-400">
            Loading WebNet CAD...
          </div>
        }
      >
        <CadApp />
      </React.Suspense>
    );
  }
  return <AdjustmentApp {...props} />;
};

export default App;
