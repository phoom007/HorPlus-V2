import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.tsx';
import './index.css';

// TODO: Replace with real Google OAuth Client ID provided by Product Owner
const GOOGLE_CLIENT_ID = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || 'PENDING_REAL_CREDENTIALS.apps.googleusercontent.com';

// Global fetch override for E2E
const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  const customInit = init || {};
  customInit.headers = {
    ...customInit.headers,
  };
  customInit.credentials = 'include';
  return originalFetch(input, customInit);
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>,
);
