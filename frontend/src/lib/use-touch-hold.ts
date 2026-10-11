import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * A touch long-press (550 ms) that opens a context menu by firing `contextmenu` at the pressed element, as a
 * right-click does. Radix's own hold cancels on *any* pointermove, and iOS fires none of its own: a small finger
 * drift (up to 12 px) is not a scroll here. The click that ends a hold is swallowed. `anchorX` places the menu.
 * Spread the handlers on the menu's trigger (pair it with `.touch-menu-target`, which stops text selection).
 */
export function useTouchHold(anchorX: (x: number) => number = x => x) {
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const suppressClick = useRef(false);
  const clear = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      clear();
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      suppressClick.current = false;
      const { clientX: x, clientY: y } = event;
      const target = event.target as HTMLElement;
      hold.current = {
        x,
        y,
        timer: window.setTimeout(() => {
          hold.current = null;
          suppressClick.current = true;
          target.dispatchEvent(
            new globalThis.MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: anchorX(x),
              clientY: y,
            }),
          );
        }, 550),
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (
        hold.current &&
        event.pointerType === 'touch' &&
        Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 12
      )
        clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: clear,
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
