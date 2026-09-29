import { useRef } from 'react';

/**
 * The value from the last render where `keep` held. A dialog whose content comes from the route uses it to keep
 * showing what it showed while it animates closed, instead of switching to whatever the new route implies.
 */
export function useRetained<T>(value: T, keep: boolean): T {
  const last = useRef(value);
  if (keep) last.current = value;
  return last.current;
}
