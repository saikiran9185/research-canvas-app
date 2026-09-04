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

/// Write raw bytes — used by the PDF export, which produces binary, not text.
#[tauri::command]
fn write_file_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
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


// ---------------------------------------------------------------------------
// Annotation storage.
//
// Comments never live inside the .canvas file. Each board gets a sibling
// hidden folder holding ONE append-only JSONL file per author:
//
//     MyBoard.canvas
//     .MyBoard.canvas.comments/
//         a3f9c2e1.jsonl      <- only this author ever writes this file
//         7b10dd54.jsonl
//
// Because a person only ever appends to their own file, two people can edit
// the same board from a synced folder (Syncthing, git, a USB stick) and never
// produce a merge conflict. Edits and deletes are appended as new lines with
// the same `id`; the frontend keeps the last line it sees for each id.
// ---------------------------------------------------------------------------

/// The comments folder for a board, created on demand.
#[tauri::command]
fn comments_dir(canvas_path: String) -> Result<String, String> {
    let p = Path::new(&canvas_path);
    let parent = p.parent().ok_or("board has no parent directory")?;
    let name = p
        .file_name()
        .ok_or("invalid board path")?
        .to_string_lossy()
        .to_string();
    let dir = parent.join(format!(".{}.comments", name));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Every *.jsonl in a comments folder — i.e. every author who has commented.
#[tauri::command]
fn list_comment_files(dir: String) -> Result<Vec<String>, String> {
    let d = Path::new(&dir);
    if !d.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(d).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path.to_string_lossy().to_string());
        }
    }
    out.sort();
    Ok(out)
}

/// Append one line to a file, creating it (and its parents) if absent.
/// This is the only write path for annotations.
#[tauri::command]
fn append_line(path: String, line: String) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line.replace('\n', "\\n")).map_err(|e| e.to_string())
}

/// Read a text file, returning "" when it does not exist yet.
#[tauri::command]
fn read_file_or_empty(path: String) -> Result<String, String> {
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Rewrite an author's file from scratch (used to compact away tombstones).
#[tauri::command]
fn rewrite_lines(path: String, lines: Vec<String>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = lines
        .iter()
        .map(|l| l.replace('\n', "\\n"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&path, format!("{}\n", body)).map_err(|e| e.to_string())
}

/// Last-modified time (epoch millis) of a file, or 0 when missing. The
/// frontend polls this to notice comments a collaborator synced in.
#[tauri::command]
fn file_mtime(path: String) -> u64 {
    fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A short stable content hash, used to name imported assets so the same file
/// imported twice (or by two collaborators) lands on one copy on disk.
fn content_hash(bytes: &[u8]) -> String {
    // FNV-1a over the content plus the length — plenty for de-duplicating
    // assets in a personal workspace, and it needs no extra dependency.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    h ^= bytes.len() as u64;
    h = h.wrapping_mul(0x1000_0000_01b3);
    format!("{:016x}", h)
}

/// Copy a file into <workspace>/.assets named by its content hash. Importing
/// the same file twice reuses the existing copy instead of duplicating it.
#[tauri::command]
fn import_media_hashed(workspace: String, src: String) -> Result<String, String> {
    let assets = Path::new(&workspace).join(".assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let src_path = Path::new(&src);
    let bytes = fs::read(src_path).map_err(|e| e.to_string())?;
    let ext = src_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let stem = src_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    // Keep the original name visible, but make the hash the identity.
    let safe: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let fname = if ext.is_empty() {
        format!("{}-{}", safe, content_hash(&bytes))
    } else {
        format!("{}-{}.{}", safe, content_hash(&bytes), ext)
    };
    let dest = assets.join(fname);
    if !dest.exists() {
        fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

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
            write_file_bytes,
            make_dir,
            import_media,
            path_exists,
            delete_path,
            rename_path,
            comments_dir,
            list_comment_files,
            append_line,
            read_file_or_empty,
            rewrite_lines,
            file_mtime,
            import_media_hashed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
