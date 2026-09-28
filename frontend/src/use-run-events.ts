import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { consumeEvents } from '@/api/events';

export function useRunEvents(onEvent: (event: Record<string, any>) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let disposed = false,
      paused = false,
      delay = 500;
    let controller: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function connect() {
      if (disposed || paused) return;
      const current = new AbortController();
      controller = current;
      let expired = false;
      let watchdog: ReturnType<typeof setTimeout>;
      const heartbeat = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          expired = true;
          current.abort();
        }, 45000);
      };
      heartbeat();
      try {
        const { data, response } = await api.GET('/api/events', { parseAs: 'stream', signal: current.signal });
        if (!response.ok || !data) throw new Error('Stream unavailable');
        await consumeEvents(data, current.signal, event => {
          heartbeat();
          if (event.type === 'snapshot') {
            setConnected(true);
            delay = 500;
          }
          handler.current(event);
        });
      } catch {
        /* Reconnect observers, never restart or cancel inference. */
      } finally {
        clearTimeout(watchdog!);
      }
      if (!disposed && !paused && controller === current && (!current.signal.aborted || expired)) {
        setConnected(false);
        retry = setTimeout(() => void connect(), delay);
        delay = Math.min(delay * 2, 10000);
      }
    }
    const pause = () => {
      paused = true;
      clearTimeout(retry);
      controller?.abort();
    };
    const resume = () => {
      paused = false;
      setConnected(false);
      clearTimeout(retry);
      controller?.abort();
      void connect();
    };
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    void connect();
    return () => {
      disposed = true;
      pause();
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
    };
  }, []);
  return connected;
}
