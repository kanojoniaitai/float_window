import { useState, useRef, useEffect } from 'react';
import type { Category } from '../app';
import { appWindow } from '@tauri-apps/api/window';
import { Search, FolderCog } from 'lucide-react';

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#73C6B6', '#AED6F1',
  '#E8AB87', '#A2D9CE', '#D7BDE2', '#AED6F1', '#FADBD8',
];

interface Props {
  categories: Category[];
  collapsed: boolean;
  onToggle: () => void;
  onSelectCategory: (id: string) => void;
  onAddCategory: (name: string) => Promise<Category>;
  onDeleteCategory: (id: string) => void;
  onDragStart: () => void;
  onOpenSearch: () => void;
  onChooseNotesDir: () => void;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y} Z`;
}

function textPosition(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const mid = (startDeg + endDeg) / 2;
  return polarToCartesian(cx, cy, r * 0.62, mid);
}

export function CircleView({ categories, collapsed, onToggle, onSelectCategory, onAddCategory, onDeleteCategory, onDragStart, onOpenSearch, onChooseNotesDir }: Props) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [targetMenu, setTargetMenu] = useState<{ catId: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const size = collapsed ? 72 : 340;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  useEffect(() => {
    if (showNewDialog && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showNewDialog]);

  useEffect(() => {
    const close = () => setTargetMenu(null);
    if (targetMenu) {
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }
  }, [targetMenu]);

  const handleAddSubmit = async () => {
    const name = newCatName.trim();
    if (!name) return;
    await onAddCategory(name);
    setNewCatName('');
    setShowNewDialog(false);
  };

  const handleCategoryClick = (catId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectCategory(catId);
  };

  const handleCategoryRightClick = (catId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTargetMenu({ catId, x: e.clientX, y: e.clientY });
  };

  const handleDeleteCat = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (targetMenu) {
      onDeleteCategory(targetMenu.catId);
      setTargetMenu(null);
    }
  };

  const startDragging = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDragStart();
    appWindow.startDragging();
  };

  if (collapsed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-transparent" onMouseDown={startDragging}>
        <div
          className="circle-sm bg-gradient-to-br from-[#5D4037] to-[#3E2723] shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-transform duration-200 animate-pulse-subtle"
          onClick={(e) => { e.stopPropagation(); onOpenSearch(); }}
          onDoubleClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          <span className="text-white font-bold text-[22px] select-none tracking-wider">N</span>
        </div>
      </div>
    );
  }

  const count = categories.length;
  const sectorDeg = count > 0 ? 360 / count : 360;

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
      <div
        className="circle-lg bg-white/10 backdrop-blur-sm shadow-2xl relative"
        onMouseDown={startDragging}
      >
        <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
          <button
            className="w-7 h-7 rounded-full bg-[#3E2723]/70 hover:bg-[#3E2723] transition-colors flex items-center justify-center"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenSearch(); }}
            title="搜索笔记"
          >
            <Search size={14} className="text-white/80" />
          </button>
          <button
            className="w-7 h-7 rounded-full bg-[#3E2723]/55 hover:bg-[#3E2723] transition-colors flex items-center justify-center"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onChooseNotesDir(); }}
            title="选择笔记目录"
          >
            <FolderCog size={14} className="text-white/70" />
          </button>
        </div>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
          <defs>
            <filter id="sectorGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {count === 0 && (
            <circle cx={cx} cy={cy} r={r} fill="rgba(62,39,35,0.12)" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
          )}

          {categories.map((cat, i) => {
            const startDeg = i * sectorDeg;
            const endDeg = (i + 1) * sectorDeg;
            const color = COLORS[i % COLORS.length];
            const label = textPosition(cx, cy, r, startDeg, endDeg);
            const displayName = cat.name.length > 4 ? cat.name.slice(0, 4) + '…' : cat.name;

            return (
              <g
                key={cat.id}
                className="sector-group cursor-pointer"
                onClick={(e: any) => handleCategoryClick(cat.id, e)}
                onContextMenu={(e: any) => handleCategoryRightClick(cat.id, e)}
              >
                <path
                  d={sectorPath(cx, cy, r, startDeg, endDeg)}
                  fill={color}
                  stroke="white"
                  strokeWidth="2.5"
                  opacity={0.88}
                  className="sector-path"
                  filter="url(#sectorGlow)"
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize="13"
                  fontWeight="700"
                  className="select-none pointer-events-none"
                  style={{ textShadow: '0 2px 4px rgba(0,0,0,0.4)' }}
                >
                  {displayName}
                </text>
              </g>
            );
          })}

          <g
            className="cursor-pointer add-center-btn"
            onClick={(e: any) => { e.stopPropagation(); setShowNewDialog(true); }}
          >
            <circle cx={cx} cy={cy} r={22} fill="white" stroke="#3E2723" strokeWidth="2.5" className="add-center-circle" />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#3E2723"
              fontSize="22"
              fontWeight="bold"
              className="select-none pointer-events-none"
            >
              +
            </text>
          </g>
        </svg>

        {showNewDialog && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="absolute inset-0 bg-black/40 rounded-full" onClick={() => setShowNewDialog(false)} />
            <div className="relative bg-white rounded-xl shadow-2xl p-4 w-[220px]" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-[#3E2723] mb-3">新建分类</h3>
              <input
                ref={inputRef}
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubmit(); if (e.key === 'Escape') setShowNewDialog(false); }}
                placeholder="输入分类名称..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#8D6E63] transition-colors"
                maxLength={20}
              />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setShowNewDialog(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                <button onClick={handleAddSubmit} className="px-3 py-1.5 text-xs bg-[#5D4037] text-white rounded-lg hover:bg-[#4E342E] transition-colors">创建</button>
              </div>
            </div>
          </div>
        )}

        {targetMenu && (
          <div
            className="absolute z-20 bg-white rounded-lg shadow-xl border border-gray-100 py-1 min-w-[120px] context-menu-enter"
            style={{ left: targetMenu.x - 60, top: targetMenu.y - 40 }}
          >
            <button
              onClick={handleDeleteCat}
              className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
            >
              <span>删除分类</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
