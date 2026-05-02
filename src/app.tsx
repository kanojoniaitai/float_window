import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { CircleView } from './components/CircleView';
import { CategoryPanel } from './components/CategoryPanel';
import { QuickSearchPanel } from './components/QuickSearchPanel';
import { ToastProvider } from './components/Toast';
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

type ViewState = 'circle-sm' | 'circle-lg' | 'panel' | 'search';

export default function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesByCategory, setNotesByCategory] = useState<Record<string, Note[]>>({});
  const [view, setView] = useState<ViewState>('circle-sm');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isDocked, setIsDocked] = useState(false);
  const [dockedEdge, setDockedEdge] = useState<string | null>(null);
  const [isStripHover, setIsStripHover] = useState(false);

  const isDraggingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shrinkRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteCounterRef = useRef(0);
  const isHoverExpandedRef = useRef(false);
  const loadingAllNotesRef = useRef(false);

  const loadCategories = useCallback(async () => {
    const cats: Category[] = await invoke('get_categories');
    setCategories(cats);
    noteCounterRef.current = cats.length;
    return cats;
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  useEffect(() => {
    const handleMouseUp = async () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      if (view === 'circle-lg' || view === 'circle-sm') {
        const edge = await invoke<string | null>('get_nearest_edge');
        if (edge) {
          await invoke('dock_to_edge', { edge });
          setIsDocked(true);
          setDockedEdge(edge);
          setView('circle-sm');
        }
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [view]);

  const loadNotes = useCallback(async (categoryId: string) => {
    const ns: Note[] = await invoke('get_notes', { categoryId });
    setNotes(ns);
  }, []);

  const loadAllNotes = useCallback(async (cats?: Category[]) => {
    if (loadingAllNotesRef.current) return;
    loadingAllNotesRef.current = true;
    try {
      const list = cats || categories;
      const map: Record<string, Note[]> = {};
      for (const c of list) {
        const ns: Note[] = await invoke('get_notes', { categoryId: c.id });
        map[c.id] = ns;
      }
      setNotesByCategory(map);
    } finally {
      loadingAllNotesRef.current = false;
    }
  }, [categories]);

  const handleToggle = useCallback(async () => {
    if (view === 'circle-sm') {
      setView('circle-lg');
      await invoke('resize_window', { width: 360, height: 360 });
    } else {
      setView('circle-sm');
      await invoke('resize_window', { width: 80, height: 80 });
    }
  }, [view]);

  const handleCircleEnter = useCallback(async () => {
    if (view === 'circle-sm' && !isDocked && !isHoverExpandedRef.current) {
      isHoverExpandedRef.current = true;
      if (shrinkRef.current) clearTimeout(shrinkRef.current);
      setView('circle-lg');
      await invoke('resize_window', { width: 360, height: 360 });
    }
  }, [view, isDocked]);

  const handleCircleLeave = useCallback(() => {
    if (view === 'circle-lg' && !isDocked && isHoverExpandedRef.current) {
      isHoverExpandedRef.current = false;
      shrinkRef.current = setTimeout(async () => {
        if (!isHoverExpandedRef.current) {
          setView('circle-sm');
          await invoke('resize_window', { width: 80, height: 80 });
        }
      }, 500);
    }
  }, [view, isDocked]);

  const handleSelectCategory = useCallback(async (catId: string) => {
    isHoverExpandedRef.current = false;
    if (shrinkRef.current) clearTimeout(shrinkRef.current);
    setSelectedCategoryId(catId);
    setView('panel');
    await invoke('resize_window', { width: 320, height: 500 });
    await loadNotes(catId);
  }, [loadNotes]);

  const handleBackToCircle = useCallback(async () => {
    setView('circle-lg');
    setSelectedCategoryId(null);
    setNotes([]);
    await invoke('resize_window', { width: 360, height: 360 });
  }, []);

  const handleBackFromSearch = useCallback(async () => {
    setView('circle-lg');
    await invoke('resize_window', { width: 360, height: 360 });
  }, []);

  const handleAddCategory = useCallback(async (name: string) => {
    const cat: Category = await invoke('create_category', { name });
    setCategories(prev => [...prev, cat]);
    setNotesByCategory(prev => ({ ...prev, [cat.id]: prev[cat.id] || [] }));
    return cat;
  }, []);

  const handleDeleteCategory = useCallback(async (catId: string) => {
    await invoke('delete_category', { categoryId: catId });
    setCategories(prev => prev.filter(c => c.id !== catId));
    setNotesByCategory(prev => {
      const next = { ...prev };
      delete next[catId];
      return next;
    });
  }, []);

  const handleRenameCategory = useCallback(async (catId: string, name: string) => {
    const updated: Category = await invoke('update_category', { categoryId: catId, name });
    setCategories(prev => prev.map(c => c.id === catId ? updated : c));
    setNotesByCategory(prev => {
      if (updated.id === catId) return prev;
      const next = { ...prev };
      const oldNotes = next[catId] || [];
      delete next[catId];
      next[updated.id] = oldNotes;
      return next;
    });
    if (selectedCategoryId === catId) {
      setSelectedCategoryId(updated.id);
      await loadNotes(updated.id);
    }
  }, [loadNotes, selectedCategoryId]);

  const handleChooseNotesDir = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    await invoke('set_notes_base_path', { path });
    setSelectedCategoryId(null);
    setNotes([]);
    setNotesByCategory({});
    await loadCategories();
    if (view === 'panel' || view === 'search') {
      setView('circle-lg');
      await invoke('resize_window', { width: 360, height: 360 });
    }
  }, [loadCategories, view]);

  const handleOpenSearch = useCallback(async () => {
    const cats = categories.length ? categories : await loadCategories();
    await loadAllNotes(cats);
    setView('search');
    await invoke('resize_window', { width: 360, height: 520 });
  }, [categories, loadAllNotes, loadCategories]);

  const handleCreateNote = useCallback(async (categoryId: string, content: string) => {
    noteCounterRef.current++;
    const id = `note-${Date.now()}-${noteCounterRef.current}`;
    const now = new Date().toISOString();
    const note: Note = await invoke('create_note', {
      categoryId,
      id,
      content,
      createdAt: now,
      updatedAt: now,
    });
    setNotes(prev => [note, ...prev]);
    setNotesByCategory(prev => ({ ...prev, [categoryId]: [note, ...(prev[categoryId] || [])] }));
  }, []);

  const handleUpdateNote = useCallback(async (noteId: string, content: string) => {
    if (!selectedCategoryId) return;
    const now = new Date().toISOString();
    await invoke('update_note', {
      categoryId: selectedCategoryId,
      noteId,
      content,
      updatedAt: now,
    });
    setNotes(prev => prev.map(n =>
      n.id === noteId ? { ...n, content, updated_at: now } : n
    ));
    setNotesByCategory(prev => ({
      ...prev,
      [selectedCategoryId]: (prev[selectedCategoryId] || []).map(n => n.id === noteId ? { ...n, content, updated_at: now } : n),
    }));
  }, [selectedCategoryId]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    if (!selectedCategoryId) return;
    await invoke('delete_note', { categoryId: selectedCategoryId, noteId });
    setNotes(prev => prev.filter(n => n.id !== noteId));
    setNotesByCategory(prev => ({
      ...prev,
      [selectedCategoryId]: (prev[selectedCategoryId] || []).filter(n => n.id !== noteId),
    }));
  }, [selectedCategoryId]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleDockedEnter = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isDocked && !isStripHover) {
      invoke('expand_docked');
      setIsStripHover(true);
    }
  }, [isDocked, isStripHover]);

  const handleDockedLeave = useCallback(() => {
    debounceRef.current = setTimeout(() => {
      if (isDocked && isStripHover) {
        invoke('collapse_docked');
        setIsStripHover(false);
      }
    }, 400);
  }, [isDocked, isStripHover]);

  const handleMinimize = useCallback(async () => {
    const edge = dockedEdge || await invoke<string | null>('get_nearest_edge') || 'right';
    await invoke('dock_to_edge', { edge });
    setIsDocked(true);
    setDockedEdge(edge);
    setIsStripHover(false);
  }, [dockedEdge]);

  if (isDocked && !isStripHover) {
    return (
      <ToastProvider>
        <div
          className="w-screen h-screen bg-transparent"
          onMouseEnter={handleDockedEnter}
          onMouseLeave={handleDockedLeave}
        >
          <div className={`w-full h-full bg-[#3E2723]/80 hover:bg-[#3E2723] transition-colors cursor-pointer flex items-center justify-center ${
            (dockedEdge === 'left' || dockedEdge === 'right') ? 'flex-col' : 'flex-row'
          }`}>
            <span className={`text-white/60 text-[10px] select-none ${dockedEdge === 'top' || dockedEdge === 'bottom' ? '' : 'writing-vertical'}`}>
              N
            </span>
          </div>
        </div>
      </ToastProvider>
    );
  }

  if (view === 'panel' && selectedCategoryId) {
    const category = categories.find(c => c.id === selectedCategoryId)!;
    return (
      <ToastProvider>
        <CategoryPanel
          category={category}
          notes={notes}
          onCreateNote={handleCreateNote}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          onRenameCategory={handleRenameCategory}
          onDeleteCategory={handleDeleteCategory}
          onBack={handleBackToCircle}
          onDragStart={handleDragStart}
        />
      </ToastProvider>
    );
  }

  if (view === 'search') {
    return (
      <ToastProvider>
        <QuickSearchPanel
          categories={categories}
          notesByCategory={notesByCategory}
          onBack={handleBackFromSearch}
          onChooseNotesDir={handleChooseNotesDir}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div
        className="w-screen h-screen bg-transparent"
        onMouseEnter={handleCircleEnter}
        onMouseLeave={handleCircleLeave}
      >
        <div className="w-full h-full flex items-center justify-center bg-transparent">
          {view === 'circle-sm' ? (
            <div className="w-[72px] h-[72px]">
              <CircleView
                categories={categories}
                collapsed={true}
                onToggle={handleToggle}
                onSelectCategory={handleSelectCategory}
                onAddCategory={handleAddCategory}
                onDeleteCategory={handleDeleteCategory}
                onDragStart={handleDragStart}
                onOpenSearch={handleOpenSearch}
                onChooseNotesDir={handleChooseNotesDir}
              />
            </div>
          ) : (
            <div className="w-[340px] h-[340px]">
              <CircleView
                categories={categories}
                collapsed={false}
                onToggle={handleToggle}
                onSelectCategory={handleSelectCategory}
                onAddCategory={handleAddCategory}
                onDeleteCategory={handleDeleteCategory}
                onDragStart={handleDragStart}
                onOpenSearch={handleOpenSearch}
                onChooseNotesDir={handleChooseNotesDir}
              />
            </div>
          )}
        </div>
        {view === 'circle-sm' && (
          <button
            className="fixed bottom-3 right-3 p-1.5 bg-[#3E2723]/60 hover:bg-[#3E2723] rounded-lg transition-colors z-50"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleMinimize}
            title="贴边隐藏"
          >
            <span className="text-white/60 text-[10px]">—</span>
          </button>
        )}
      </div>
    </ToastProvider>
  );
}
