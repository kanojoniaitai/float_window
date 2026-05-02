import { useState, useEffect, useRef, useMemo } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { readText } from '@tauri-apps/api/clipboard';
import { ArrowLeft, GripHorizontal, Plus, Trash2, MoreVertical, Edit2, Search, X, ClipboardPaste } from 'lucide-react';
import { TextItem } from './TextItem';
import type { Category, Note } from '../app';

interface Props {
  category: Category;
  notes: Note[];
  onCreateNote: (categoryId: string, content: string) => Promise<void>;
  onUpdateNote: (id: string, content: string) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onRenameCategory: (catId: string, name: string) => Promise<void>;
  onDeleteCategory: (catId: string) => Promise<void>;
  onBack: () => void;
  onDragStart: () => void;
}

export function CategoryPanel({
  category, notes, onCreateNote, onUpdateNote, onDeleteNote,
  onRenameCategory, onDeleteCategory, onBack, onDragStart,
}: Props) {
  const [hoverCard, setHoverCard] = useState<{ content: string; rect: DOMRect } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [catName, setCatName] = useState(category.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newNoteInputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(n => n.content.toLowerCase().includes(q));
  }, [notes, searchQuery]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (showNewInput && newNoteInputRef.current) {
      newNoteInputRef.current.focus();
    }
  }, [showNewInput]);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMenu]);

  const handleDragStart = () => {
    onDragStart();
    appWindow.startDragging();
  };

  const handleRename = async () => {
    const name = catName.trim();
    if (name && name !== category.name) {
      await onRenameCategory(category.id, name);
    }
    setIsRenaming(false);
    setCatName(name || category.name);
  };

  const handleDelete = async () => {
    await onDeleteCategory(category.id);
    onBack();
  };

  const handleCreateNote = async () => {
    const content = newNoteContent.trim();
    if (!content) return;
    await onCreateNote(category.id, content);
    setNewNoteContent('');
    setShowNewInput(false);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await readText();
      if (text && text.trim()) {
        await onCreateNote(category.id, text.trim());
      }
    } catch {
      console.log('Failed to read clipboard');
    }
  };

  return (
    <div className="w-full h-full flex flex-col rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2.5 bg-[#3E2723] select-none shrink-0"
        onMouseDown={handleDragStart}
      >
        <GripHorizontal size={14} className="text-white/40 cursor-grab shrink-0" />
        <button
          onClick={onBack}
          className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
          title="返回扇形菜单"
        >
          <ArrowLeft size={14} className="text-white/70" />
        </button>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setIsRenaming(false); setCatName(category.name); }
            }}
            className="flex-1 bg-white/10 text-sm font-bold text-[#F9F6F0] px-2 py-0.5 rounded outline-none min-w-0"
            maxLength={20}
          />
        ) : (
          <h1
            className="text-sm font-bold text-[#F9F6F0] tracking-wider flex-1 min-w-0 truncate cursor-pointer hover:text-white/80"
            onDoubleClick={() => setIsRenaming(true)}
          >
            {category.name}
          </h1>
        )}

        <button
          onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(''); }}
          className={`p-0.5 rounded transition-colors shrink-0 ${showSearch ? 'bg-white/20' : 'hover:bg-white/10'}`}
          title="搜索"
        >
          <Search size={13} className={showSearch ? 'text-white' : 'text-white/50'} />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
          >
            <MoreVertical size={14} className="text-white/50" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-100 py-1 min-w-[120px] z-30">
              <button
                onClick={() => { setShowMenu(false); setIsRenaming(true); }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <Edit2 size={11} /> 重命名
              </button>
              <button
                onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <Trash2 size={11} /> 删除分类
              </button>
            </div>
          )}
        </div>

        <span className="text-[10px] text-white/40 shrink-0">{notes.length} 条</span>
      </div>

      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#EFEBE9] shrink-0 border-b border-[#D7CCC8]/50">
          <Search size={12} className="text-[#8D6E63] shrink-0" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索笔记..."
            className="flex-1 bg-transparent text-xs text-[#3E2723] outline-none placeholder:text-gray-400"
            onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); } }}
          />
          {searchQuery && (
            <>
              <span className="text-[10px] text-[#8D6E63] shrink-0">{filteredNotes.length} 项</span>
              <button
                onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                className="p-0.5 rounded hover:bg-[#D7CCC8]/50 transition-colors shrink-0"
              >
                <X size={10} className="text-[#8D6E63]" />
              </button>
            </>
          )}
          <button
            onClick={() => { setShowSearch(false); setSearchQuery(''); }}
            className="p-0.5 rounded hover:bg-[#D7CCC8]/50 transition-colors shrink-0"
          >
            <X size={12} className="text-[#8D6E63]" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#F9F6F0] flex flex-col">
        <div className="sticky top-0 bg-[#F9F6F0] px-2 pt-2 pb-1 z-[5]">
          {showNewInput ? (
            <div className="bg-white rounded-lg shadow-sm border border-[#8D6E63]/20 p-2">
              <textarea
                ref={newNoteInputRef}
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleCreateNote();
                  }
                  if (e.key === 'Escape') {
                    setShowNewInput(false);
                    setNewNoteContent('');
                  }
                }}
                placeholder="输入笔记内容... (Enter 保存, Esc 取消)"
                className="w-full text-xs text-[#1A1A1A] bg-transparent outline-none resize-none leading-relaxed"
                rows={2}
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  onClick={() => { setShowNewInput(false); setNewNoteContent(''); }}
                  className="px-2 py-1 text-[10px] text-gray-400 hover:bg-gray-100 rounded transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateNote}
                  className="px-2 py-1 text-[10px] bg-[#5D4037] text-white rounded hover:bg-[#4E342E] transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowNewInput(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-[#8D6E63] hover:bg-[#EFEBE9] rounded-lg transition-colors border border-dashed border-[#BCAAA4]/40"
              >
                <Plus size={13} />
                <span>新建笔记</span>
              </button>
              <button
                onClick={handlePasteFromClipboard}
                className="flex items-center justify-center gap-1 py-2 px-2.5 text-xs text-[#8D6E63] hover:bg-[#EFEBE9] rounded-lg transition-colors border border-dashed border-[#BCAAA4]/40 shrink-0"
                title="从剪贴板粘贴"
              >
                <ClipboardPaste size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="px-2 pb-2 flex flex-col gap-0.5">
          {filteredNotes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-400 text-xs gap-2">
              <span className="text-3xl opacity-30">{searchQuery ? '🔍' : '📝'}</span>
              <p>{searchQuery ? '未找到匹配的笔记' : '暂无笔记，点击上方按钮创建'}</p>
            </div>
          ) : (
            filteredNotes.map(n => (
              <TextItem
                key={n.id}
                note={n}
                onUpdate={onUpdateNote}
                onDelete={onDeleteNote}
                onHoverCard={(content, rect) => setHoverCard({ content, rect })}
                onLeaveCard={() => setHoverCard(null)}
              />
            ))
          )}
        </div>
      </div>

      {hoverCard && <HoverCard content={hoverCard.content} rect={hoverCard.rect} onClose={() => setHoverCard(null)} />}

      {showDeleteConfirm && (
        <div className="absolute inset-0 flex items-center justify-center z-40 bg-black/30">
          <div className="bg-white rounded-xl shadow-2xl p-4 w-[240px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-[#3E2723] mb-2">删除分类</h3>
            <p className="text-xs text-gray-500 mb-4">确定要删除「{category.name}」及其所有笔记吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
              <button onClick={handleDelete} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HoverCard({ content, rect, onClose }: { content: string; rect: DOMRect; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const cardWidth = 280;
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  let left = rect.right + 12;
  let top = rect.top;
  if (left + cardWidth > winW - 8) left = rect.left - cardWidth - 12;
  if (left < 8) left = 8;
  if (top + 240 > winH) top = winH - 260;
  if (top < 8) top = 8;

  const arrowOnLeft = left >= rect.right - 2;

  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        className="fixed bg-white rounded-xl shadow-2xl border border-gray-100 p-4 bubble-enter"
        style={{ left, top, width: cardWidth, maxHeight: '45vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {arrowOnLeft && (
          <div className="absolute -left-2 top-6 w-4 h-4 bg-white transform rotate-45 border-l border-b border-gray-100" />
        )}
        {!arrowOnLeft && (
          <div className="absolute -right-2 top-6 w-4 h-4 bg-white transform rotate-45 border-r border-t border-gray-100" />
        )}
        <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap break-words overflow-y-auto max-h-[40vh] custom-scrollbar select-text">
          {content}
        </p>
      </div>
    </div>
  );
}
