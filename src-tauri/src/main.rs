#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, PhysicalPosition, PhysicalSize, CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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

#[derive(Serialize, Deserialize)]
struct CategoryIndex {
    categories: Vec<Category>,
    category_counter: u64,
}

fn get_notes_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let mut path = app_handle.path_resolver().app_data_dir().expect("Failed to get app data dir");
    path.push("notes");
    fs::create_dir_all(&path).expect("Failed to create notes dir");
    path
}

fn get_index_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_notes_dir(app_handle).join("_categories.json")
}

fn read_index(app_handle: &tauri::AppHandle) -> CategoryIndex {
    let path = get_index_path(app_handle);
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(CategoryIndex { categories: vec![], category_counter: 0 })
    } else {
        CategoryIndex { categories: vec![], category_counter: 0 }
    }
}

fn save_index(app_handle: &tauri::AppHandle, index: &CategoryIndex) {
    let path = get_index_path(app_handle);
    fs::write(&path, serde_json::to_string_pretty(index).unwrap()).unwrap();
}

fn note_path(app_handle: &tauri::AppHandle, category_id: &str, note_id: &str) -> PathBuf {
    get_notes_dir(app_handle).join(category_id).join(format!("{}.json", note_id))
}

#[tauri::command]
fn get_categories(app_handle: tauri::AppHandle) -> Vec<Category> {
    read_index(&app_handle).categories
}

#[tauri::command]
fn create_category(app_handle: tauri::AppHandle, name: String) -> Result<Category, String> {
    let mut index = read_index(&app_handle);
    index.category_counter += 1;
    let id = format!("cat-{}", index.category_counter);

    let cat_dir = get_notes_dir(&app_handle).join(&id);
    fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;

    let cat = Category { id: id.clone(), name };
    index.categories.push(cat.clone());
    save_index(&app_handle, &index);
    Ok(cat)
}

#[tauri::command]
fn update_category(app_handle: tauri::AppHandle, category_id: String, name: String) -> Result<Category, String> {
    let mut index = read_index(&app_handle);
    let cat = index.categories.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    cat.name = name;
    let result = cat.clone();
    save_index(&app_handle, &index);
    Ok(result)
}

#[tauri::command]
fn delete_category(app_handle: tauri::AppHandle, category_id: String) -> Result<(), String> {
    let cat_dir = get_notes_dir(&app_handle).join(&category_id);
    if cat_dir.exists() {
        fs::remove_dir_all(&cat_dir).map_err(|e| e.to_string())?;
    }
    let mut index = read_index(&app_handle);
    index.categories.retain(|c| c.id != category_id);
    save_index(&app_handle, &index);
    Ok(())
}

#[tauri::command]
fn get_notes(app_handle: tauri::AppHandle, category_id: String) -> Vec<Note> {
    let cat_dir = get_notes_dir(&app_handle).join(&category_id);
    let mut notes = Vec::new();
    if let Ok(entries) = fs::read_dir(&cat_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(data) = fs::read_to_string(&path) {
                    if let Ok(note) = serde_json::from_str::<Note>(&data) {
                        notes.push(note);
                    }
                }
            }
        }
    }
    notes.sort_by_key(|n| n.updated_at.clone());
    notes.reverse();
    notes
}

#[tauri::command]
fn create_note(app_handle: tauri::AppHandle, category_id: String, id: String, content: String, created_at: String, updated_at: String) -> Result<Note, String> {
    let cat_dir = get_notes_dir(&app_handle).join(&category_id);
    fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;

    let note = Note {
        id: id.clone(),
        content,
        category_id: category_id.clone(),
        created_at,
        updated_at,
    };

    let path = note_path(&app_handle, &category_id, &id);
    fs::write(&path, serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
fn update_note(app_handle: tauri::AppHandle, category_id: String, note_id: String, content: String, updated_at: String) -> Result<Note, String> {
    let path = note_path(&app_handle, &category_id, &note_id);
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut note: Note = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    note.content = content;
    note.updated_at = updated_at;
    fs::write(&path, serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
fn delete_note(app_handle: tauri::AppHandle, category_id: String, note_id: String) -> Result<(), String> {
    let path = note_path(&app_handle, &category_id, &note_id);
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
    let quit_item = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show_item)
        .add_item(hide_item)
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
