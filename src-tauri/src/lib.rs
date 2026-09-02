// Research Canvas — Rust backend.
// These commands give the frontend full read/write access to the user's
// workspace folder on disk (no fs-plugin scope juggling — Rust has direct access).
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Return (creating if needed) the default workspace at ~/ResearchCanvas.
#[tauri::command]
fn default_workspace() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("could not find home directory")?;
    // Store boards in Documents so the workspace never collides with the app's
    // own project folder. Falls back to the home directory if Documents is absent.
    let base = home.join("Documents");
    let ws = if base.is_dir() { base.join("Research Canvas") } else { home.join("Research Canvas") };
    fs::create_dir_all(&ws).map_err(|e| e.to_string())?;
    fs::create_dir_all(ws.join(".assets")).map_err(|e| e.to_string())?;
    Ok(ws.to_string_lossy().to_string())
}

/// List folders and .canvas files in a directory (hides dotfiles like .assets).
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut out: Vec<Entry> = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let p = entry.path();
        let is_dir = p.is_dir();
        if is_dir || name.ends_with(".canvas") {
            out.push(Entry {
                name,
                path: p.to_string_lossy().to_string(),
                is_dir,
            });
        }
    }
    // Folders first, then alphabetical.
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_text(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Copy an imported media file into <workspace>/.assets and return its absolute path.
#[tauri::command]
fn import_media(workspace: String, src: String) -> Result<String, String> {
    let assets = Path::new(&workspace).join(".assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let src_path = Path::new(&src);
    let fname = src_path
        .file_name()
        .ok_or("invalid source file")?
        .to_string_lossy()
        .to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let dest = assets.join(format!("{}-{}", ts, fname));
    fs::copy(src_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            default_workspace,
            list_dir,
            read_file_text,
            write_file_text,
            make_dir,
            import_media,
            path_exists,
            delete_path,
            rename_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
