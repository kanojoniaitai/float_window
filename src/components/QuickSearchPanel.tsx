import { useEffect, useMemo, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { ArrowLeft, Search, X, Copy, FolderCog } from 'lucide-react';
import type { Category, Note } from '../app';
import { useToast } from './Toast';

type SearchItem = {
  category: Category;
  note: Note;
};

interface Props {
  categories: Category[];
  notesByCategory: Record<string, Note[]>;
  onBack: () => void;
  onChooseNotesDir: () => void;
}

export function QuickSearchPanel({ categories, notesByCategory, onBack, onChooseNotesDir }: Props) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allItems = useMemo(() => {
    const out: SearchItem[] = [];
    for (const c of categories) {
      const ns = notesByCategory[c.id] || [];
      for (const n of ns) out.push({ category: c, note: n });
    }
    return out;
  }, [categories, notesByCategory]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return allItems;
    return allItems.filter(({ note, category }) => {
      return note.content.toLowerCase().includes(query) || category.name.toLowerCase().includes(query);
    });
  }, [allItems, q]);

  const handleCopy = async (item: SearchItem) => {
    await writeText(item.note.content);
    showToast('已复制到剪贴板', 'copy');
  };

  return (
    <div className="w-full h-full flex flex-col rounded-xl overflow-hidden bg-[#F9F6F0]">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#3E2723] select-none shrink-0">
        <button
          onClick={onBack}
          className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
          title="返回"
        >
          <ArrowLeft size={14} className="text-white/70" />
        </button>
        <div className="flex items-center gap-2 flex-1 bg-white/10 rounded-lg px-2 py-1">
          <Search size={13} className="text-white/60 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 bg-transparent text-xs text-[#F9F6F0] outline-none placeholder:text-white/30"
            placeholder="搜索内容 / 分类..."
          />
          {q && (
            <button
              onClick={() => { setQ(''); inputRef.current?.focus(); }}
              className="p-0.5 rounded hover:bg-white/10 transition-colors"
              title="清空"
            >
              <X size={12} className="text-white/60" />
            </button>
          )}
        </div>
        <button
          onClick={onChooseNotesDir}
          className="p-1 rounded hover:bg-white/10 transition-colors shrink-0"
          title="选择笔记目录"
        >
          <FolderCog size={14} className="text-white/60" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-xs text-gray-400">
            未找到匹配的笔记
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.slice(0, 120).map(({ category, note }) => (
              <button
                key={`${category.id}/${note.id}`}
                className="w-full text-left bg-white rounded-lg border border-[#D7CCC8]/50 hover:border-[#BCAAA4] hover:shadow-sm transition-all px-3 py-2 flex items-start gap-2"
                onClick={() => handleCopy({ category, note })}
                title="点击复制"
              >
                <div className="mt-0.5 w-6 h-6 rounded-full bg-gradient-to-br from-[#EFEBE9] to-[#D7CCC8] flex items-center justify-center shrink-0">
                  <Copy size={12} className="text-[#795548]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-[#8D6E63] shrink-0">{category.name}</span>
                    <span className="text-[10px] text-gray-300 shrink-0">/</span>
                    <span className="text-[11px] text-[#3E2723] truncate">
                      {note.content.split('\n').find(l => l.trim())?.slice(0, 60) || '未命名'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-gray-400 whitespace-pre-wrap break-words max-h-[32px] overflow-hidden">
                    {note.content.slice(0, 160)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
