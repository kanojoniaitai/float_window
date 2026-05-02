import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { appWindow } from '@tauri-apps/api/window';
import { ToastProvider, useToast } from './components/Toast';
import { QuickSearchPanel } from './components/QuickSearchPanel';
import './index.css';

export interface Category {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  content: string;
  category_id: string;
  created_at: string;
  updated_at: string;
}

type ViewState = 'ball' | 'panel';

const DEFAULT_CATEGORY = 'Inbox';

export default function App() {
  const [view, setView] = useState<ViewState>('ball');
  const [categories, setCategories] = useState<Category[]>([]);
  const [notesByCategory, setNotesByCategory] = useState<Record<string, Note[]>>({});

  const mouseDownRef = useRef<{ x: number; y: number; dragging: boolean; armed: boolean } | null>(null);
  const noteCounterRef = useRef(0);

  const loadCategories = useCallback(async () => {
    const cats: Category[] = await invoke('get_categories');
    setCategories(cats);
    noteCounterRef.current = cats.length;
    return cats;
  }, []);

  const ensureDefaultCategory = useCallback(async (cats?: Category[]) => {
    const list = cats || categories;
    if (list.some(c => c.name === DEFAULT_CATEGORY)) return;
    try {
      const created: Category = await invoke('create_category', { name: DEFAULT_CATEGORY });
      setCategories(prev => [...prev, created]);
      setNotesByCategory(prev => ({ ...prev, [created.id]: prev[created.id] || [] }));
    } catch {
      const refreshed = await loadCategories();
      setCategories(refreshed);
    }
  }, [categories, loadCategories]);

  const loadAllNotes = useCallback(async (cats?: Category[]) => {
    const list = cats || categories;
    const map: Record<string, Note[]> = {};
    for (const c of list) {
      const ns: Note[] = await invoke('get_notes', { categoryId: c.id });
      map[c.id] = ns;
    }
    setNotesByCategory(map);
  }, [categories]);

  useEffect(() => {
    (async () => {
      const cats = await loadCategories();
      await ensureDefaultCategory(cats);
      await loadAllNotes(cats);
    })();
  }, [ensureDefaultCategory, loadAllNotes, loadCategories]);

  const sortedNotes = useMemo(() => {
    const items: Array<{ category: Category; note: Note }> = [];
    for (const c of categories) {
      const ns = notesByCategory[c.id] || [];
      for (const n of ns) items.push({ category: c, note: n });
    }
    items.sort((a, b) => b.note.updated_at.localeCompare(a.note.updated_at));
    return items;
  }, [categories, notesByCategory]);

  const openPanel = useCallback(async () => {
    const cats = categories.length ? categories : await loadCategories();
    await ensureDefaultCategory(cats);
    await loadAllNotes(cats);
    setView('panel');
    await invoke('resize_window', { width: 380, height: 560 });
  }, [categories, ensureDefaultCategory, loadAllNotes, loadCategories]);

  const closePanel = useCallback(async () => {
    setView('ball');
    await invoke('resize_window', { width: 80, height: 80 });
  }, []);

  const chooseNotesDir = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    await invoke('set_notes_base_path', { path });
    const cats = await loadCategories();
    await ensureDefaultCategory(cats);
    await loadAllNotes(cats);
  }, [ensureDefaultCategory, loadAllNotes, loadCategories]);

  const ensureCategoryId = useCallback(async (name: string) => {
    const trimmed = name.trim() || DEFAULT_CATEGORY;
    const existing = categories.find(c => c.name === trimmed);
    if (existing) return existing.id;
    const created: Category = await invoke('create_category', { name: trimmed });
    setCategories(prev => [...prev, created]);
    setNotesByCategory(prev => ({ ...prev, [created.id]: prev[created.id] || [] }));
    return created.id;
  }, [categories]);

  const createNote = useCallback(async (categoryName: string, content: string) => {
    const catId = await ensureCategoryId(categoryName);
    noteCounterRef.current += 1;
    const id = `note-${Date.now()}-${noteCounterRef.current}`;
    const now = new Date().toISOString();
    const note: Note = await invoke('create_note', {
      categoryId: catId,
      id,
      content,
      createdAt: now,
      updatedAt: now,
    });
    setNotesByCategory(prev => ({ ...prev, [catId]: [note, ...(prev[catId] || [])] }));
  }, [ensureCategoryId]);

  if (view === 'panel') {
    return (
      <ToastProvider>
        <QuickSearchPanel
          categories={categories}
          defaultCategoryName={DEFAULT_CATEGORY}
          notes={sortedNotes}
          onClose={closePanel}
          onChooseNotesDir={chooseNotesDir}
          onCreateNote={createNote}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <FloatingBall onOpen={openPanel} mouseDownRef={mouseDownRef} />
    </ToastProvider>
  );
}

function FloatingBall({ onOpen, mouseDownRef }: { onOpen: () => void; mouseDownRef: MutableRefObject<{ x: number; y: number; dragging: boolean; armed: boolean } | null> }) {
  const { showToast } = useToast();

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownRef.current = { x: e.clientX, y: e.clientY, dragging: false, armed: true };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const st = mouseDownRef.current;
    if (!st?.armed || st.dragging) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.hypot(dx, dy) >= 4) {
      st.dragging = true;
      st.armed = false;
      appWindow.startDragging();
      showToast('拖动悬浮球可移动位置', 'success');
    }
  };

  const onMouseUp = () => {
    const st = mouseDownRef.current;
    mouseDownRef.current = null;
    if (!st) return;
    if (!st.dragging) onOpen();
  };

  return (
    <div className="w-screen h-screen bg-transparent grid place-items-center">
      <div
        className="ballRoot select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <div className="ballHalo" />
        <div className="ballCore">
          <span className="ballGlyph">N</span>
        </div>
      </div>
    </div>
  );
}
