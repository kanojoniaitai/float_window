import { useState, useRef, useEffect } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { Edit2, FileText, Trash2, Clock, Check } from 'lucide-react';
import { useToast } from './Toast';
import type { Note } from '../app';

const LONG_TEXT_THRESHOLD = 40;

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Props {
  note: Note;
  onUpdate: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onHoverCard: (content: string, rect: DOMRect) => void;
  onLeaveCard: () => void;
}

export function TextItem({ note, onUpdate, onDelete, onHoverCard, onLeaveCard }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(note.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { showToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongText = note.content.length > LONG_TEXT_THRESHOLD;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
    }
  }, [isEditing]);

  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [confirmDelete]);

  const handleCopy = async (e: React.MouseEvent) => {
    if (isEditing || confirmDelete) return;
    e.stopPropagation();
    await writeText(note.content);
    showToast('已复制到剪贴板', 'copy');
  };

  const handleSave = async () => {
    setIsEditing(false);
    if (content.trim() && content !== note.content) {
      await onUpdate(note.id, content);
    } else {
      setContent(note.content);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      await onDelete(note.id);
    } else {
      setConfirmDelete(true);
    }
  };

  const handleMouseEnter = () => {
    if (isLongText && !isEditing) {
      hoverTimer.current = setTimeout(() => {
        if (rowRef.current) onHoverCard(note.content, rowRef.current.getBoundingClientRect());
      }, 500);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    onLeaveCard();
  };

  if (isEditing) {
    return (
      <div className="mx-1 p-2 bg-white rounded-lg shadow-sm border border-blue-200 ring-1 ring-blue-100">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
            if (e.key === 'Escape') { setIsEditing(false); setContent(note.content); }
          }}
          className="w-full text-xs text-[#1A1A1A] bg-transparent outline-none resize-none leading-relaxed"
          rows={3}
        />
        <div className="flex justify-between items-center mt-1">
          <span className="text-[9px] text-gray-400">{formatTime(note.updated_at)}</span>
          <button onMouseDown={(e) => { e.preventDefault(); handleSave(); }} className="p-1 rounded hover:bg-gray-100">
            <Check size={12} className="text-green-600" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-white hover:shadow-sm transition-all duration-150"
      onClick={handleCopy}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#EFEBE9] to-[#D7CCC8] flex items-center justify-center shrink-0 shadow-sm">
        <FileText size={11} className="text-[#795548]" />
      </div>
      <div className="flex-1 min-w-0">
        {confirmDelete ? (
          <p className="text-[11px] text-red-600 leading-snug font-medium">确定删除？再次点击确认</p>
        ) : (
          <p className={`text-[11px] text-[#3E2723] leading-snug ${isLongText ? 'truncate' : ''}`}>
            {note.content}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[9px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          <Clock size={8} />
          {formatTime(note.updated_at)}
        </span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-0.5 rounded hover:bg-gray-200 transition-colors">
            <Edit2 size={10} className="text-gray-500" />
          </button>
          <button onClick={handleDelete} className={`p-0.5 rounded transition-colors ${confirmDelete ? 'bg-red-100 hover:bg-red-200' : 'hover:bg-gray-200'}`}>
          <Trash2 size={10} className={confirmDelete ? 'text-red-600' : 'text-gray-400'} />
        </button>
        <div className="p-0.5 text-[10px] text-gray-400 font-medium">C</div>
        </div>
      </div>
    </div>
  );
}
