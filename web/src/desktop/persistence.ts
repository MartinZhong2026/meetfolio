import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyNotebook,
  parseNotebook,
  recoverNotebook,
  type Notebook,
} from './model';
const DB = 'meetfolio-desktop-v1';
export async function openNotebookDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('notebook');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(
        new Error(
          'Cannot open local database. Allow browser storage and do not clear site data.',
        ),
      );
    req.onblocked = () =>
      reject(
        new Error('Another window holds the database. Close duplicate Meetfolio windows and retry.'),
      );
  });
}
export async function readNotebook(): Promise<Notebook> {
  const db = await openNotebookDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db
        .transaction('notebook', 'readonly')
        .objectStore('notebook')
        .get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return value === undefined ? emptyNotebook() : parseNotebook(value);
  } finally {
    db.close();
  }
}
export async function writeNotebook(book: Notebook): Promise<void> {
  const db = await openNotebookDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notebook', 'readwrite');
      tx.objectStore('notebook').put(book, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Local save interrupted'));
    });
  } finally {
    db.close();
  }
}
export function useNotebook() {
  const [book, setBook] = useState<Notebook | null>(null);
  const [saved, setSaved] = useState<Notebook | null>(null);
  const [error, setError] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [retry, setRetry] = useState(0);
  const queue = useRef(Promise.resolve());
  const latest = useRef<Notebook | null>(null);
  latest.current = book;
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unlock: (() => void) | undefined;
    // A second tab must not overwrite a whole-notebook snapshot from an older view.
    const load = async () => {
      try {
        const r = recoverNotebook(await readNotebook());
        if (!cancelled) {
          setBook(r.book);
          setRecovered(r.recovered);
        }
      } catch {
        if (!cancelled)
          setError('Cannot read local notebook. Existing data unchanged; check storage permission.');
      }
    };
    if (navigator.locks) {
      void navigator.locks.request(
        'meetfolio-desktop-writer',
        { ifAvailable: true },
        async (lock) => {
          if (cancelled) return;
          if (!lock) {
            setReadOnly(true);
            return;
          }
          await load();
          if (cancelled) return;
          await new Promise<void>((resolve) => {
            unlock = resolve;
          });
        },
      );
    } else {
      setReadOnly(true);
    }
    return () => {
      cancelled = true;
      const snapshot = latest.current;
      if (snapshot) {
        // Keep the writer lock until the final queued snapshot commits on SPA unmount.
        queue.current = queue.current
          .catch(() => {})
          .then(() => writeNotebook(snapshot));
        void queue.current.catch(() => {}).finally(() => unlock?.());
      } else unlock?.();
    };
  }, []);
  useEffect(() => {
    if (!book || readOnly) return;
    const timer = setTimeout(() => {
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          try {
            await writeNotebook(book);
            if (latest.current === book) {
              setSaved(book);
              setError('');
            }
          } catch {
            if (latest.current === book)
              setError(
                'Unsaved: local storage is unavailable or full. Export JSON immediately and retry.',
              );
          }
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [book, retry, readOnly]);
  const update = useCallback((change: (book: Notebook) => Notebook) => {
    setBook((current) => {
      if (!current) return current;
      return change(current);
    });
  }, []);
  useEffect(() => window.meetfolioDesktop?.onBeforeClose?.(async () => {
    // Native final events arrive before this callback. Let React commit their functional updates.
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 50); requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });
    const current = latest.current;
    // Before the initial read completes, no editable notebook exists and no writes can be lost.
    // Leave existing disk data untouched instead of treating startup as a failed save.
    if (!current || readOnly) return true;
    const snapshot = {
      ...current,
      interviews: current.interviews.map(i => ['starting', 'recording'].includes(i.recording)
        ? { ...i, recording: 'interrupted' as const, interruption: 'Microphone stopped on exit; confirmed text saved. Review the end before continuing.' } : i),
    };
    try {
      queue.current = queue.current.catch(() => {}).then(() => writeNotebook(snapshot));
      await queue.current;
      latest.current = snapshot;
      setBook(snapshot); setSaved(snapshot); setError('');
      return true;
    } catch { setError('Save-before-exit failed. Export a backup and retry.'); return false; }
  }), [readOnly]);
  const dirty = !!book && saved !== book;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        dirty ||
        book?.interviews.some((i) =>
          ['starting', 'recording'].includes(i.recording),
        )
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, book]);
  return {
    book,
    update,
    dirty,
    error,
    recovered,
    readOnly,
    retrySave: () => setRetry((n) => n + 1),
  };
}
