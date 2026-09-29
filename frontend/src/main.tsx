import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LazyMotion, MotionConfig } from 'motion/react';
import { App } from './app';
import './styles.css';

export const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Motion follows the operator's reduced-motion setting everywhere; features load after first paint. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion strict features={() => import('./lib/motion-features').then(module => module.default)}>
          <BrowserRouter>
            <Routes>
              <Route path="*" element={<App />} />
            </Routes>
          </BrowserRouter>
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  </React.StrictMode>,
);
