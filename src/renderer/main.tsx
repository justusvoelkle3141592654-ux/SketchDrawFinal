import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary, installGlobalErrorHandlers } from './ui/ErrorBoundary';
import './styles/tokens.css';
import './styles/app.css';

installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary name="Workspace" kind="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
