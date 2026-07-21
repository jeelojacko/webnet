import React from 'react';
import AppShell from './components/app/AppShell';
import { useAppController, type AppControllerProps } from './hooks/useAppController';

const App: React.FC<AppControllerProps> = (props) => {
  const controller = useAppController(props);
  return <AppShell controller={controller} />;
};

export default App;
