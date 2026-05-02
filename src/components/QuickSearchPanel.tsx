import { useEffect, useMemo, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { FolderCog, Plus, Search, X, Copy, Check } from 'lucide-react';
import type { Category, Note } from '../app';
import { useToast } from './Toast';

type Row = { category: Category; note: Note };

interface Props {
  categories: Category[];
  defaultCategoryName: string;
  notes: Row[];
  onClose: () => void;
  onChooseNotesDir: () => void;
  onCreateNote: (categoryName: string, content: string) => Promise<void>;
}

function firstLine(markdown: string): string {
  const line = markdown.split('\n').find(l => l.trim());
  if (!line) return '未命名';
  return line.replace(/^#+\s*/, '').trim().slice(0, 80) || '未命名';
}

export function QuickSearchPanel({ categories, defaultCategoryName, notes, onClose, onChooseNotesDir, onCreateNote }: Props) {
  const [q, setQ] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [categoryName, setCategoryName] = useState(defaultCategoryName);
  const [content, setContent] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (composerOpen) composeRef.current?.focus();
  }, [composerOpen]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter(r => {
      return r.category.name.toLowerCase().includes(query) || r.note.content.toLowerCase().includes(query);
    });
  }, [notes, q]);

  const copyAndClose = async (row: Row) => {
    await writeText(row.note.content);
    showToast('已复制到剪贴板', 'copy');
    onClose();
  };

  const saveNote = async () => {
    const body = content.trim();
    if (!body) return;
    const cat = categoryName.trim() || defaultCategoryName;
    await onCreateNote(cat, body);
    setContent('');
    setComposerOpen(false);
    setQ('');
    showToast('已保存', 'success');
    searchRef.current?.focus();
  };

  return (
    <div className="w-full h-full p-3">
      <div className="panelRoot w-full h-full rounded-[22px] overflow-hidden">
        <div className="panelHeader px-3.5 py-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tracking-[0.22em] uppercase text-white/60">
              Float Notes
            </div>
            <div className="text-[14px] font-semibold text-white/92 leading-tight truncate">
              即开即用 · 点击复制
            </div>
          </div>
          <button
            className="iconBtn"
            onClick={onChooseNotesDir}
            title="选择笔记目录"
          >
            <FolderCog size={16} />
          </button>
          <button
            className="iconBtn"
            onClick={onClose}
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-3.5 pb-3">
          <div className="searchWrap flex items-center gap-2 px-3 py-2">
            <Search size={16} className="text-white/45" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="searchInput flex-1"
              placeholder="搜索内容 / 分类…  Enter 复制第一条"
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter') {
                  if (composerOpen) return;
                  const first = filtered[0];
                  if (first) copyAndClose(first);
                }
              }}
            />
            {q && (
              <button
                className="chipBtn"
                onClick={() => { setQ(''); searchRef.current?.focus(); }}
                title="清空"
              >
                清空
              </button>
            )}
            <button
              className="primaryBtn flex items-center gap-1.5"
              onClick={() => setComposerOpen(v => !v)}
              title="新建笔记"
            >
              <Plus size={14} />
              新建
            </button>
          </div>
        </div>

        {composerOpen && (
          <div className="px-3.5 pb-3">
            <div className="composerCard p-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/55 shrink-0">分类</span>
                <select
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="selectField flex-1"
                >
                  <option value={defaultCategoryName}>{defaultCategoryName}</option>
                  {categories
                    .filter(c => c.name !== defaultCategoryName)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                </select>
                <input
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="textField w-[132px]"
                  placeholder="或输入新分类"
                />
              </div>
              <div className="mt-2">
                <textarea
                  ref={composeRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="textareaField w-full"
                  rows={7}
                  placeholder="输入 Markdown…  Ctrl+Enter 保存"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setComposerOpen(false); setContent(''); }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      saveNote();
                    }
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  className="chipBtn"
                  onClick={() => { setComposerOpen(false); setContent(''); }}
                >
                  取消
                </button>
                <button
                  className="saveBtn flex items-center gap-1.5"
                  onClick={saveNote}
                >
                  <Check size={14} />
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-3.5 pb-3">
          <div className="listWrap">
            {filtered.length === 0 ? (
              <div className="emptyState">
                <div className="emptyTitle">没有匹配结果</div>
                <div className="emptyHint">点“新建”写一条，保存后点击即可复制</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.slice(0, 120).map(r => (
                  <button
                    key={`${r.category.id}/${r.note.id}`}
                    className="rowCard"
                    onClick={() => copyAndClose(r)}
                    title="点击复制并关闭"
                  >
                    <div className="rowLeft">
                      <div className="rowDot" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="tag">{r.category.name}</span>
                        <span className="rowTitle truncate">{firstLine(r.note.content)}</span>
                      </div>
                      <div className="rowBody">
                        {r.note.content.slice(0, 140)}
                      </div>
                    </div>
                    <div className="rowRight">
                      <Copy size={14} className="text-white/45" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
