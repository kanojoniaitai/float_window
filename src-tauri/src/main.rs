#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, PhysicalPosition, PhysicalSize, CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

struct AppState {
    docked_edge: Mutex<Option<String>>,
}

const STRIP_SIZE: u32 = 8;
const CIRCLE_SM: u32 = 80;
const PANEL_WIDTH: u32 = 320;
const EDGE_THRESHOLD: i32 = 20;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Category {
    id: String,
    name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Note {
    id: String,
    content: String,
    category_id: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct Settings {
    notes_root: Option<String>,
}

fn sanitize_path_component(input: &str) -> String {
    let mut s: String = input
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '＿',
            c if c.is_control() => ' ',
            _ => c,
        })
        .collect();
    s = s.trim().to_string();
    while s.ends_with('.') || s.ends_with(' ') {
        s.pop();
    }
    if s.is_empty() { "未命名".to_string() } else { s }
}

fn is_safe_id(id: &str) -> bool {
    !(id.contains("..") || id.contains('/') || id.contains('\\'))
}

fn get_settings_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = app_handle
        .path_resolver()
        .app_data_dir()
        .expect("Failed to get app data dir");
    fs::create_dir_all(&dir).expect("Failed to create app data dir");
    dir.join("settings.json")
}

fn read_settings(app_handle: &tauri::AppHandle) -> Settings {
    let path = get_settings_path(app_handle);
    if !path.exists() {
        return Settings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app_handle: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = get_settings_path(app_handle);
    fs::write(&path, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_notes_root(app_handle: &tauri::AppHandle) -> PathBuf {
    let settings = read_settings(app_handle);
    if let Some(p) = settings.notes_root {
        let candidate = PathBuf::from(p);
        if candidate.is_absolute() {
            let _ = fs::create_dir_all(&candidate);
            return candidate;
        }
    }
    let base = app_handle
        .path_resolver()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let path = base.join("SideDrawerNotes");
    fs::create_dir_all(&path).expect("Failed to create notes root dir");
    path
}

fn get_notes_root(app_handle: &tauri::AppHandle) -> PathBuf {
    resolve_notes_root(app_handle)
}

fn category_dir(app_handle: &tauri::AppHandle, category_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(category_id) {
        return Err("Invalid category id".into());
    }
    Ok(get_notes_root(app_handle).join(category_id))
}

fn note_path(app_handle: &tauri::AppHandle, category_id: &str, note_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(category_id) {
        return Err("Invalid category id".into());
    }
    if !is_safe_id(note_id) {
        return Err("Invalid note id".into());
    }
    Ok(get_notes_root(app_handle)
        .join(category_id)
        .join(format!("{}.md", note_id)))
}

fn parse_frontmatter(content: &str) -> (Option<std::collections::HashMap<String, String>>, String) {
    if !content.starts_with("---\n") {
        return (None, content.to_string());
    }
    let rest = &content[4..];
    if let Some(end) = rest.find("\n---\n") {
        let fm = &rest[..end];
        let body = &rest[end + 5..];
        let mut map = std::collections::HashMap::new();
        for line in fm.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Some((k, v)) = line.split_once(':') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
        (Some(map), body.to_string())
    } else {
        (None, content.to_string())
    }
}

fn extract_title(markdown: &str) -> String {
    for line in markdown.lines() {
        let t = line.trim();
        if t.is_empty() { continue; }
        let t = t.trim_start_matches('#').trim();
        if t.is_empty() { continue; }
        let mut s = t.to_string();
        if s.len() > 80 {
            s.truncate(80);
        }
        return s;
    }
    "未命名".to_string()
}

fn build_markdown_file(note_id: &str, created_at: &str, updated_at: &str, body: &str) -> String {
    let title = extract_title(body);
    format!(
        "---\nid: {note_id}\ntitle: {title}\ncreated_at: {created_at}\nupdated_at: {updated_at}\n---\n{body}",
    )
}

fn open_dir_in_explorer(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Explorer open is only supported on Windows".into())
    }
}

#[tauri::command]
fn get_notes_root_path(app_handle: tauri::AppHandle) -> String {
    get_notes_root(&app_handle).to_string_lossy().to_string()
}

#[tauri::command]
fn set_notes_base_path(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("Path must be absolute".into());
    }
    let mut settings = read_settings(&app_handle);
    settings.notes_root = Some(p.to_string_lossy().to_string());
    save_settings(&app_handle, &settings)?;
    let root = get_notes_root(&app_handle);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reset_notes_base_path(app_handle: tauri::AppHandle) -> Result<(), String> {
    let mut settings = read_settings(&app_handle);
    settings.notes_root = None;
    save_settings(&app_handle, &settings)?;
    Ok(())
}

#[tauri::command]
fn get_categories(app_handle: tauri::AppHandle) -> Vec<Category> {
    let root = get_notes_root(&app_handle);
    let mut cats = Vec::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if !ft.is_dir() { continue; }
            } else {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            cats.push(Category { id: name.clone(), name });
        }
    }
    cats.sort_by(|a, b| a.name.cmp(&b.name));
    cats
}

#[tauri::command]
fn create_category(app_handle: tauri::AppHandle, name: String) -> Result<Category, String> {
    let folder = sanitize_path_component(&name);
    let cat_dir = get_notes_root(&app_handle).join(&folder);
    if cat_dir.exists() {
        return Err("Category already exists".into());
    }
    fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;
    Ok(Category { id: folder.clone(), name: folder })
}

#[tauri::command]
fn update_category(app_handle: tauri::AppHandle, category_id: String, name: String) -> Result<Category, String> {
    let old_dir = category_dir(&app_handle, &category_id)?;
    if !old_dir.exists() {
        return Err("Category not found".into());
    }
    let folder = sanitize_path_component(&name);
    let new_dir = get_notes_root(&app_handle).join(&folder);
    if new_dir.exists() && folder != category_id {
        return Err("Category already exists".into());
    }
    if folder != category_id {
        fs::rename(&old_dir, &new_dir).map_err(|e| e.to_string())?;
    }
    Ok(Category { id: folder.clone(), name: folder })
}

#[tauri::command]
fn delete_category(app_handle: tauri::AppHandle, category_id: String) -> Result<(), String> {
    let cat_dir = category_dir(&app_handle, &category_id)?;
    if cat_dir.exists() {
        fs::remove_dir_all(&cat_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_notes(app_handle: tauri::AppHandle, category_id: String) -> Vec<Note> {
    let cat_dir = match category_dir(&app_handle, &category_id) {
        Ok(p) => p,
        Err(_) => return vec![],
    };
    let mut notes = Vec::new();
    if let Ok(entries) = fs::read_dir(&cat_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Ok(data) = fs::read_to_string(&path) {
                    let (fm, body) = parse_frontmatter(&data);
                    let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    if id.is_empty() { continue; }
                    let created_at = fm.as_ref().and_then(|m| m.get("created_at").cloned()).unwrap_or_default();
                    let updated_at = fm.as_ref().and_then(|m| m.get("updated_at").cloned()).unwrap_or_default();
                    notes.push(Note {
                        id,
                        content: body,
                        category_id: category_id.clone(),
                        created_at,
                        updated_at,
                    });
                }
            }
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes
}

#[tauri::command]
fn create_note(app_handle: tauri::AppHandle, category_id: String, id: String, content: String, created_at: String, updated_at: String) -> Result<Note, String> {
    let cat_dir = category_dir(&app_handle, &category_id)?;
    fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;

    let path = note_path(&app_handle, &category_id, &id)?;
    if path.exists() {
        return Err("Note already exists".into());
    }
    let file = build_markdown_file(&id, &created_at, &updated_at, &content);
    fs::write(&path, file).map_err(|e| e.to_string())?;

    Ok(Note {
        id,
        content,
        category_id,
        created_at,
        updated_at,
    })
}

#[tauri::command]
fn update_note(app_handle: tauri::AppHandle, category_id: String, note_id: String, content: String, updated_at: String) -> Result<Note, String> {
    let path = note_path(&app_handle, &category_id, &note_id)?;
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (fm, _body) = parse_frontmatter(&data);
    let created_at = fm.as_ref().and_then(|m| m.get("created_at").cloned()).unwrap_or_default();
    let file = build_markdown_file(&note_id, &created_at, &updated_at, &content);
    fs::write(&path, file).map_err(|e| e.to_string())?;

    Ok(Note {
        id: note_id,
        content,
        category_id,
        created_at,
        updated_at,
    })
}

#[tauri::command]
fn delete_note(app_handle: tauri::AppHandle, category_id: String, note_id: String) -> Result<(), String> {
    let path = note_path(&app_handle, &category_id, &note_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn dock_window_to_edge(window: &tauri::Window, edge: &str) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        match edge {
            "right" => {
                window.set_size(PhysicalSize::new(STRIP_SIZE, screen.height)).unwrap();
                window.set_position(PhysicalPosition::new(screen.width as i32 - STRIP_SIZE as i32, 0)).unwrap();
            }
            "left" => {
                window.set_size(PhysicalSize::new(STRIP_SIZE, screen.height)).unwrap();
                window.set_position(PhysicalPosition::new(0, 0)).unwrap();
            }
            "top" => {
                window.set_size(PhysicalSize::new(screen.width, STRIP_SIZE)).unwrap();
                window.set_position(PhysicalPosition::new(0, 0)).unwrap();
            }
            "bottom" => {
                window.set_size(PhysicalSize::new(screen.width, STRIP_SIZE)).unwrap();
                window.set_position(PhysicalPosition::new(0, screen.height as i32 - STRIP_SIZE as i32)).unwrap();
            }
            _ => {}
        }
    }
}

#[tauri::command]
fn resize_window(window: tauri::Window, width: u32, height: u32) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        let pos = window.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
        let cx = pos.x + (window.outer_size().unwrap().width as i32) / 2;
        let cy = pos.y + (window.outer_size().unwrap().height as i32) / 2;
        let mut nx = cx - (width as i32) / 2;
        let mut ny = cy - (height as i32) / 2;
        if nx < 0 { nx = 0; }
        if ny < 0 { ny = 0; }
        if nx + width as i32 > screen.width as i32 { nx = screen.width as i32 - width as i32; }
        if ny + height as i32 > screen.height as i32 { ny = screen.height as i32 - height as i32; }
        window.set_size(PhysicalSize::new(width, height)).unwrap();
        window.set_position(PhysicalPosition::new(nx, ny)).unwrap();
    }
}

#[tauri::command]
fn dock_to_edge(window: tauri::Window, edge: String, state: tauri::State<AppState>) {
    dock_window_to_edge(&window, &edge);
    *state.docked_edge.lock().unwrap() = Some(edge);
}

#[tauri::command]
fn expand_docked(window: tauri::Window, state: tauri::State<AppState>) {
    let edge = state.docked_edge.lock().unwrap().clone();
    if let Some(ref e) = edge {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let screen = monitor.size();
            match e.as_str() {
                "right" => {
                    window.set_size(PhysicalSize::new(PANEL_WIDTH, screen.height)).unwrap();
                    window.set_position(PhysicalPosition::new(screen.width as i32 - PANEL_WIDTH as i32, 0)).unwrap();
                }
                "left" => {
                    window.set_size(PhysicalSize::new(PANEL_WIDTH, screen.height)).unwrap();
                    window.set_position(PhysicalPosition::new(0, 0)).unwrap();
                }
                "top" => {
                    window.set_size(PhysicalSize::new(screen.width, 420)).unwrap();
                    window.set_position(PhysicalPosition::new(0, 0)).unwrap();
                }
                "bottom" => {
                    window.set_size(PhysicalSize::new(screen.width, 420)).unwrap();
                    window.set_position(PhysicalPosition::new(0, screen.height as i32 - 420)).unwrap();
                }
                _ => {}
            }
        }
    }
}

#[tauri::command]
fn collapse_docked(window: tauri::Window, state: tauri::State<AppState>) {
    let edge = state.docked_edge.lock().unwrap().clone();
    if let Some(e) = edge {
        dock_window_to_edge(&window, &e);
    }
}

#[tauri::command]
fn get_nearest_edge(window: tauri::Window) -> Option<String> {
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let monitor = window.current_monitor().ok()??;
    let screen = monitor.size();

    let near_right = pos.x + size.width as i32 >= screen.width as i32 - EDGE_THRESHOLD;
    let near_left = pos.x <= EDGE_THRESHOLD;
    let near_top = pos.y <= EDGE_THRESHOLD;
    let near_bottom = pos.y + size.height as i32 >= screen.height as i32 - EDGE_THRESHOLD;

    if near_right { Some("right".into()) }
    else if near_left { Some("left".into()) }
    else if near_top { Some("top".into()) }
    else if near_bottom { Some("bottom".into()) }
    else { None }
}

#[tauri::command]
fn undock_window(state: tauri::State<AppState>) {
    *state.docked_edge.lock().unwrap() = None;
}

fn main() {
    let show_item = CustomMenuItem::new("show".to_string(), "显示");
    let hide_item = CustomMenuItem::new("hide".to_string(), "隐藏");
    let open_notes_dir_item = CustomMenuItem::new("open_notes_dir".to_string(), "打开笔记目录");
    let quit_item = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show_item)
        .add_item(hide_item)
        .add_item(open_notes_dir_item)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(quit_item);

    let tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(AppState {
            docked_edge: Mutex::new(None),
        })
        .system_tray(tray)
        .on_system_tray_event(|app, event| {
            let window = app.get_window("main").unwrap();
            match event {
                SystemTrayEvent::LeftClick { .. } => {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
                SystemTrayEvent::MenuItemClick { id, .. } => {
                    match id.as_str() {
                        "show" => { window.show().unwrap(); window.set_focus().unwrap(); }
                        "hide" => { window.hide().unwrap(); }
                        "open_notes_dir" => {
                            let root = get_notes_root(&app.app_handle());
                            let _ = open_dir_in_explorer(&root);
                        }
                        "quit" => { std::process::exit(0); }
                        _ => {}
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            let main_window = app.get_window("main").unwrap();
            if let Ok(Some(monitor)) = main_window.current_monitor() {
                let screen = monitor.size();
                let x = (screen.width - CIRCLE_SM) as i32 / 2;
                let y = (screen.height - CIRCLE_SM) as i32 / 2;
                main_window.set_size(PhysicalSize::new(CIRCLE_SM, CIRCLE_SM)).unwrap();
                main_window.set_position(PhysicalPosition::new(x, y)).unwrap();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            resize_window,
            dock_to_edge,
            expand_docked,
            collapse_docked,
            get_nearest_edge,
            undock_window,
            get_notes_root_path,
            set_notes_base_path,
            reset_notes_base_path,
            get_categories,
            create_category,
            update_category,
            delete_category,
            get_notes,
            create_note,
            update_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
