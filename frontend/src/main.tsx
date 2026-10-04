import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LazyMotion, MotionConfig } from 'motion/react';
import { App } from './app';
import { OrganizationsProvider } from './lib/organizations';
import { AuthGate } from './lib/auth';
import './styles.css';
// Registers the service worker for every visitor, signed in or not (installable before sign-in).
import './lib/pwa';

export const queryClient = new QueryClient();

// The dashboard is an app, not a document: the browser's page menu (Back, Save as, Print…) is noise here.
// Keep it only where it helps: editable fields, links, and selected text you may want to copy. The app's
// own context menus (messages, computers) call preventDefault themselves and are unaffected.
document.addEventListener('contextmenu', event => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href]')) return;
  if (window.getSelection()?.toString().trim()) return;
  event.preventDefault();
});

// Nor does it zoom (owner's choice): the viewport meta covers Android, but iOS ignores it, so Safari's pinch
// gestures are cancelled here and double-tap zoom by touch-action in styles.css.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Motion follows the operator's reduced-motion setting everywhere; features load after first paint. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion strict features={() => import('./lib/motion-features').then(module => module.default)}>
          {/* Nothing below loads until someone is signed in (docs/login.md). */}
          <AuthGate>
            <BrowserRouter>
              <OrganizationsProvider>
                <Routes>
                  <Route path="*" element={<App />} />
                </Routes>
              </OrganizationsProvider>
            </BrowserRouter>
          </AuthGate>
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  </React.StrictMode>,
);
