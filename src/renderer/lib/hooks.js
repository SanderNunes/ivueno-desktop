import { useCallback, useEffect, useRef, useState } from 'react';
import { call, on } from './bridge.js';

/**
 * Load something from the main process and keep it fresh. `kinds` are the 'data:changed' kinds that should reload it;
 * `id` limits the reload to changes about that one meeting. Reloads are debounced so a burst becomes one call.
 */
export function useQuery(channel, arg, { kinds = [], id = null, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const argKey = JSON.stringify(arg ?? null);
  const seq = useRef(0);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const n = ++seq.current;
    try {
      const data = await call(channel, arg);
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, argKey, enabled]);

  useEffect(() => { load(); }, [load]);

  const kindKey = kinds.join(',');
  useEffect(() => on('data:changed', (e) => {
    if (e.kind !== 'all' && !kinds.includes(e.kind)) return;
    if (id && e.id && e.id !== id) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [load, kindKey, id]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { ...state, reload: load };
}

export function useMeeting(id) {
  return useQuery('meetings:get', id, { kinds: ['meetings', 'segments', 'notes', 'tasks', 'chat'], id, enabled: !!id });
}

/** The live recording state, pushed by the main process once a second. */
export function useRecState() {
  const [snap, setSnap] = useState(null);
  useEffect(() => {
    let alive = true;
    call('rec:state').then((s) => { if (alive) setSnap((cur) => cur || s); }).catch(() => {});
    const off = on('rec:state', setSnap);
    return () => { alive = false; off(); };
  }, []);
  return snap;
}

/** Run `fn` after `ms` of quiet. Used for autosave. */
export function useDebounced(fn, ms) {
  const ref = useRef(fn);
  const timer = useRef(null);
  ref.current = fn;
  const run = useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(...args), ms);
  }, [ms]);
  const flush = useCallback((...args) => { clearTimeout(timer.current); timer.current = null; return ref.current(...args); }, []);
  const cancel = useCallback(() => { clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { run, flush, cancel };
}

/** Close a popup when the user clicks elsewhere or presses Escape. */
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  return ref;
}
