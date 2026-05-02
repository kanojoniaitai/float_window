.### 第一阶段：技术栈选型

**选型方案：Tauri 2.0 + Rust + React 18 (TypeScript) + Tailwind CSS**

**选择理由：**
1. **极致轻量与低资源占用：** Tauri 抛弃了 Chromium 内核，转而使用系统原生 WebView (Windows 上的 WebView2)。相比 Electron 动辄百兆的内存占用和巨大的包体积，Tauri 编译后的可执行文件通常在 5-10MB 左右，常驻后台内存占用极低，完美契合“侧边栏抽屉”这种需要长期潜伏的系统级增强工具需求。
2. **底层控制力（Rust）：** 需要实现精准的“屏幕边缘吸附”、“窗口尺寸动态计算”及“系统级剪贴板读写”，Rust 提供了极高的执行效率和调用 Windows 核心 API 的能力，且无缝嵌入 Tauri 的生命周期。
3. **高效 UI 渲染：** React 配合 Tailwind CSS 能够以声明式语法快速构建极简主义的现代排版，轻松实现状态驱动的“悬停展开/收起”及“行内编辑”视图切换。

---

### 第二阶段：架构设计

1. **主进程逻辑 (Rust Core)：**
   - **窗口管理器：** 初始化为无边框 (Frameless)、置顶 (Always on top) 窗口。动态读取主显示器分辨率，将其高度设为屏幕高度，初始宽度设为 10px，固定贴合于屏幕最右侧。
   - **指令通道 (IPC Commands)：** 暴露 `expand_window` 和 `collapse_window` 给前端调用。暴露 `read_store` 和 `write_store` 用于本地持久化交互。
2. **渲染进程逻辑 (React + Web API)：**
   - **事件监听：** 在根 DOM 节点绑定 `onMouseEnter` 和 `onMouseLeave` 事件。当鼠标移入 10px 的感应区，调用 IPC 通知 Rust 展开窗口至 300px；鼠标移出则缩回 10px。
   - **交互封装：** 使用 `@tauri-apps/plugin-clipboard-manager` 实现点击文字秒级复制。实现双击或点击编辑按钮进入 `contenteditable` 或 Input 状态，失去焦点 (blur) 自动触发保存。
3. **本地数据持久化方案：**
   - 使用 Rust 标准库 `std::fs` 直接读写应用数据目录 (App Data Directory) 下的 `snippets.json`。数据结构采用扁平化的分类 JSON，轻量、零依赖且易于手动备份。

---

### 第三阶段：多智能体 (Multi-Agent) 协作流输出

#### 1. 架构师 Agent：环境配置与目录树

```text
// 项目目录结构树
SideDrawer/
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   └── components/
│       └── TextItem.tsx
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        └── main.rs
```

```json
// src-tauri/tauri.conf.json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devPath": "http://localhost:1420",
    "distDir": "../dist"
  },
  "package": {
    "productName": "SideDrawer",
    "version": "1.0.0"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "fs": { "all": true, "scope": ["$APPDATA/**"] },
      "path": { "all": true },
      "window": { "all": true }
    },
    "windows": [
      {
        "title": "SideDrawer",
        "width": 10,
        "height": 1080,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false
      }
    ],
    "security": {
      "csp": null
    }
  }
}
```

```toml
// src-tauri/Cargo.toml
[package]
name = "sidedrawer"
version = "1.0.0"
description = "A lightweight side drawer application"
authors = ["you"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "1.5", features = [] }

[dependencies]
tauri = { version = "1.5", features = ["api-all"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

```json
// package.json
{
  "name": "sidedrawer",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^1.5.3",
    "lucide-react": "^0.363.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.2.2",
    "vite": "^5.2.0"
  }
}
```

#### 2. 交互 Agent：核心系统集成逻辑

```rust
// src-tauri/src/main.rs
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, PhysicalPosition, PhysicalSize};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn expand_window(window: tauri::Window) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen_size = monitor.size();
        let height = screen_size.height;
        let width = 320; // 展开宽度
        let x = screen_size.width as i32 - width as i32;
        
        window.set_size(PhysicalSize::new(width, height)).unwrap();
        window.set_position(PhysicalPosition::new(x, 0)).unwrap();
    }
}

#[tauri::command]
fn collapse_window(window: tauri::Window) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen_size = monitor.size();
        let height = screen_size.height;
        let width = 15; // 感应区宽度留白
        let x = screen_size.width as i32 - width as i32;
        
        window.set_size(PhysicalSize::new(width, height)).unwrap();
        window.set_position(PhysicalPosition::new(x, 0)).unwrap();
    }
}

#[tauri::command]
fn read_store(app_handle: tauri::AppHandle) -> String {
    let path = get_store_path(&app_handle);
    fs::read_to_string(path).unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
fn write_store(app_handle: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = get_store_path(&app_handle);
    fs::write(path, data).map_err(|e| e.to_string())
}

fn get_store_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let mut path = app_handle.path_resolver().app_data_dir().expect("Failed to get app data dir");
    fs::create_dir_all(&path).expect("Failed to create app data dir");
    path.push("snippets.json");
    path
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let main_window = app.get_window("main").unwrap();
            // 初始化缩起状态
            if let Ok(Some(monitor)) = main_window.current_monitor() {
                let screen_size = monitor.size();
                let width = 15; 
                let x = screen_size.width as i32 - width as i32;
                main_window.set_size(PhysicalSize::new(width, screen_size.height)).unwrap();
                main_window.set_position(PhysicalPosition::new(x, 0)).unwrap();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            expand_window,
            collapse_window,
            read_store,
            write_store
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 3. UI Agent：视图与状态管理

```typescript
// src/App.tsx
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { TextItem } from './components/TextItem';
import './index.css';

export interface Snippet {
  id: string;
  category: string;
  content: string;
}

export default function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const dataStr: string = await invoke('read_store');
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.length === 0) {
        // 初始占位数据
        setSnippets([
          { id: '1', category: '警句 (Quotes)', content: 'Stay hungry, stay foolish.' },
          { id: '2', category: '提示词 (Prompts)', content: 'Translate the following text to English, keeping the professional tone.' },
          { id: '3', category: '快捷键 (Hotkeys)', content: 'Ctrl + Shift + T : Reopen closed tab' }
        ]);
      } else {
        setSnippets(parsed);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdate = async (id: string, newContent: string) => {
    const updated = snippets.map(s => s.id === id ? { ...s, content: newContent } : s);
    setSnippets(updated);
    await invoke('write_store', { data: JSON.stringify(updated) });
  };

  const handleMouseEnter = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!isExpanded) {
      invoke('expand_window');
      setIsExpanded(true);
    }
  };

  const handleMouseLeave = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      invoke('collapse_window');
      setIsExpanded(false);
    }, 300); // 300ms 缓冲防止误触关闭
  };

  return (
    <div 
      className="w-screen h-screen flex justify-end bg-transparent"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 边缘感应器 / 主抽屉容器 */}
      <div className={`h-full shadow-2xl transition-all duration-300 ease-in-out bg-[#F9F6F0] flex flex-col ${isExpanded ? 'w-[320px]' : 'w-[15px] opacity-10 bg-black'}`}>
        {isExpanded && (
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
            <h1 className="text-xl font-bold text-[#1A1A1A] tracking-wider border-b-2 border-[#1A1A1A] pb-2">Snippets.</h1>
            
            {['警句 (Quotes)', '提示词 (Prompts)', '快捷键 (Hotkeys)'].map(cat => (
              <div key={cat} className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold text-[#3E2723] uppercase tracking-widest opacity-60">{cat}</h2>
                <div className="flex flex-col gap-2">
                  {snippets.filter(s => s.category === cat).map(snippet => (
                    <TextItem key={snippet.id} item={snippet} onUpdate={handleUpdate} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

```typescript
// src/components/TextItem.tsx
import { useState, useRef, useEffect } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { Copy, Edit2, Check } from 'lucide-react';
import type { Snippet } from '../App';

interface Props {
  item: Snippet;
  onUpdate: (id: string, content: string) => void;
}

export function TextItem({ item, onUpdate }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
    }
  }, [isEditing]);

  const handleCopy = async () => {
    if (isEditing) return;
    await writeText(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    setIsEditing(false);
    if (content !== item.content) {
      onUpdate(item.id, content);
    }
  };

  return (
    <div 
      className="group relative bg-white p-3 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-all"
      onClick={!isEditing ? handleCopy : undefined}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          className="w-full text-sm text-[#1A1A1A] bg-transparent outline-none resize-none"
          rows={3}
        />
      ) : (
        <p className="text-sm text-[#3E2723] leading-relaxed cursor-pointer break-words">
          {item.content}
        </p>
      )}

      {/* 悬浮操作栏 */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
        {isEditing ? (
          <button onMouseDown={(e) => { e.preventDefault(); handleSave(); }} className="p-1 bg-[#F9F6F0] rounded hover:bg-gray-200">
            <Check size={14} className="text-green-600" />
          </button>
        ) : (
          <>
            <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-1 bg-[#F9F6F0] rounded hover:bg-gray-200">
              <Edit2 size={14} className="text-gray-600" />
            </button>
            <div className="p-1 bg-[#F9F6F0] rounded">
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-gray-600" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  overflow: hidden; /* 防止出现系统滚动条 */
  background-color: transparent;
}

/* 隐藏 Webview 默认的高亮边框 */
* {
  -webkit-tap-highlight-color: transparent;
}

/* 极简自定义滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #d4d4d4;
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #a3a3a3;
}
```

---

### 终端构建与运行指南

确保您的开发环境已全局安装 Node.js (v18+) 及 Rust 工具链 (`rustup`, `cargo`)，并且已安装 Windows C++ 生成工具配置 Tauri 依赖环境。

在目标工作空间中，执行以下严格顺序指令：

1. **初始化环境与安装依赖**
```bash
npm install -g create-vite
# 如果需要重建脚手架可以运行，由于已提供全部源码，可直接建立空目录后执行：
npm init -y
npm install react react-dom @tauri-apps/api lucide-react
npm install -D typescript vite @vitejs/plugin-react tailwindcss postcss autoprefixer @types/react @types/react-dom
```

2. **配置 Tailwind CSS**
```bash
npx tailwindcss init -p
```
*(请确保修改 `tailwind.config.js` 的 `content` 字段包含 `["./index.html", "./src/**/*.{js,ts,jsx,tsx}"]`)*

3. **首次调试运行（开发模式）**
```bash
npm run tauri dev
```
*(此命令会自动编译 Rust 后端并启动 Vite 静态服务，应用将静默贴合于主屏幕右侧边界。)*

4. **编译 Release 桌面可执行文件**
```bash
npm run tauri build
```
*(编译产物位于 `src-tauri/target/release/sidedrawer.exe`。该程序具备完全独立的跨系统运行能力。)*