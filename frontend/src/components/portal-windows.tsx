import { useEffect } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { computersQuery } from '@/lib/computers-query';
import { terminalSessionsQuery } from '@/lib/computer-terminals';
import { computerPath } from '@/lib/dashboard-location';
import { useWindowLayer, type Box } from '@/lib/floating-windows';
import {
  closeWindow,
  minimizeWindow,
  openWindow,
  saveBox,
  savedBox,
  usePortalWindows,
  type PortalWindow,
} from '@/lib/portal-windows';
import type { ComputerAgentState } from './computer-control';
import { FloatingChat } from './floating-chat';
import { FloatingComputer } from './floating-computer';
import { TerminalWindow } from './floating-terminal';
import { CloseLight, MinimizeLight } from './ui/close-light';
import { ChatIcon, ComputerIcon, TerminalIcon } from './ui/icons';

const page = () => ({
  left: 0,
  top: 0,
  width: window.innerWidth,
  height: window.innerHeight,
  right: window.innerWidth,
});

/** Where a minimized window goes: its dock button, or the dock's middle before the button exists. */
const dockPoint = (key: string) => {
  const button = document.querySelector(`[data-dock-key="${CSS.escape(key)}"]`)?.getBoundingClientRect();
  return button
    ? { x: button.left + button.width / 2, y: button.top + button.height / 2 }
    : { x: window.innerWidth / 2, y: window.innerHeight - 24 };
};

/**
 * The windows Portal pulled out, over every page: chats, terminals and desktops. Each has a red light (close) and a
 * yellow one (minimize into the dock at the bottom); they keep their place when the page changes and are remembered
 * per browser.
 */
export function PortalWindows({
  agentState,
  onNavigate,
}: {
  agentState: ComputerAgentState & { chat: NonNullable<ComputerAgentState['chat']> };
  onNavigate: (path: string) => void;
}) {
  const windows = usePortalWindows();
  const open = windows.filter(item => !item.minimized);
  const docked = windows.filter(item => item.minimized);
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-30">
        <AnimatePresence>
          {open.map(item => (
            <PortalWindowView key={item.key} item={item} agentState={agentState} onNavigate={onNavigate} />
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {docked.length > 0 && (
          <m.nav
            aria-label="Minimized windows"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="portal-glass fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-xl border border-white/10 p-1 shadow-xl shadow-black/50 max-md:bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
          >
            {docked.map(item => (
              <button
                key={item.key}
                type="button"
                data-dock-key={item.key}
                onClick={event => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openWindow(item.target, item.title, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}
                className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {item.target.kind === 'chat' ? (
                  <ChatIcon className="size-3.5" />
                ) : item.target.kind === 'terminal' ? (
                  <TerminalIcon className="size-3.5" />
                ) : (
                  <ComputerIcon className="size-3.5" />
                )}
                <span className="max-w-32 truncate">{item.title}</span>
              </button>
            ))}
          </m.nav>
        )}
      </AnimatePresence>
    </>
  );
}

function PortalWindowView({
  item,
  agentState,
  onNavigate,
}: {
  item: PortalWindow;
  agentState: ComputerAgentState & { chat: NonNullable<ComputerAgentState['chat']> };
  onNavigate: (path: string) => void;
}) {
  const layer = useWindowLayer(item.key);
  const lights = (
    <span className="flex shrink-0 items-center gap-1.5">
      <CloseLight label={`Close ${item.title}`} onClick={() => closeWindow(item.key)} dim={!layer.focused} />
      <MinimizeLight
        label={`Minimize ${item.title}`}
        onClick={() => minimizeWindow(item.key, dockPoint(item.key))}
        dim={!layer.focused}
      />
    </span>
  );
  const remember = (box: Box) => saveBox(item.key, box);
  const target = item.target;
  const computers = useQuery({ ...computersQuery, enabled: target.kind === 'computer' });
  const sessions = useQuery({
    ...terminalSessionsQuery(target.kind === 'terminal' ? target.computerId : ''),
    enabled: target.kind === 'terminal',
    refetchInterval: 4000,
  });
  const session =
    target.kind === 'terminal' ? sessions.data?.sessions.find(entry => entry.id === target.session) : undefined;
  // A terminal deleted elsewhere closes its window.
  useEffect(() => {
    if (target.kind === 'terminal' && sessions.isSuccess && !session) closeWindow(item.key);
  }, [sessions.isSuccess, session]);

  if (target.kind === 'chat') {
    const agent = agentState.agents.find(entry => entry.id === target.agentId);
    if (!agent) return null;
    return (
      <div className="pointer-events-none absolute inset-0">
        <FloatingChat
          agent={agent}
          state={agentState}
          from={item.from ? new DOMRect(item.from.x, item.from.y, 0, 0) : null}
          onMinimize={() => closeWindow(item.key)}
          windowId={item.key}
          lights={lights}
          initial={savedBox(item.key)}
          onBox={remember}
        />
      </div>
    );
  }
  if (target.kind === 'terminal') {
    if (!session) return null;
    return (
      <div className="pointer-events-auto">
        <TerminalWindow
          computerId={target.computerId}
          session={session}
          from={item.from ? { left: item.from.x, top: item.from.y, width: 0, height: 0 } : null}
          cascade={0}
          viewer={page}
          onClose={() => closeWindow(item.key)}
          lights={lights}
          // First opened from Portal: near the top middle of the page, where it is easy to grab.
          initial={
            savedBox(item.key) ?? {
              x: Math.max(16, (window.innerWidth - 760) / 2),
              y: 72,
              width: Math.min(760, window.innerWidth - 32),
              height: 0,
            }
          }
          onBox={remember}
        />
      </div>
    );
  }
  const computer = computers.data?.computers.find(entry => entry.id === target.computerId);
  if (computers.isSuccess && !computer) {
    closeWindow(item.key);
    return null;
  }
  return (
    <div className="pointer-events-auto">
      <FloatingComputer
        computerId={target.computerId}
        name={computer?.name ?? item.title}
        running={computer ? computer.state === 'running' : true}
        windowId={item.key}
        from={item.from}
        lights={lights}
        initial={savedBox(item.key)}
        onBox={remember}
        onExpand={() => onNavigate(computerPath(target.computerId))}
      />
    </div>
  );
}
