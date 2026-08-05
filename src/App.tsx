import React from 'react';
import AppShell from './components/app/AppShell';
import { useAppController, type AppControllerProps } from './hooks/useAppController';
import StudyApp from './study/StudyApp';

const AdjustmentApp: React.FC<AppControllerProps> = (props) => {
  const controller = useAppController(props);
  return <AppShell controller={controller} />;
};

const App: React.FC<AppControllerProps> = (props) =>
  typeof window !== 'undefined' && window.location.pathname.startsWith('/study') ? (
    <StudyApp />
  ) : (
    <AdjustmentApp {...props} />
  );

export default App;
