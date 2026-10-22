#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::Write,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct WorkbenchServer(Mutex<Option<Child>>);

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().into_owned();
    text.strip_prefix("\\\\?\\")
        .map(PathBuf::from)
        .unwrap_or(path)
}

fn find_node() -> Result<PathBuf, String> {
    let output = Command::new("where.exe")
        .arg("node.exe")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| format!("无法检查 Node.js：{e}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .ok_or_else(|| "没有找到 Node.js。请先安装 Node.js，再启动 Claude Workbench。".to_owned())
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Tauri project must live in a src-tauri directory")
        .to_path_buf()
}

fn packaged_workbench_root(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let resources = normalize_windows_path(app.path().resource_dir()?);
    let executable_dir = normalize_windows_path(std::env::current_exe()?
        .parent()
        .ok_or_else(|| std::io::Error::other("无法找到桌面程序目录"))?
        .to_path_buf());
    // Prefer resources shipped beside the executable. `resource_dir()` can
    // resolve to a host application's cache when this app is launched from a
    // wrapped desktop environment, which may contain an older Workbench copy.
    let candidates = [
        executable_dir.join("workbench"),
        executable_dir.join("resources").join("workbench"),
        resources.join("workbench"),
        resources.clone(),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.join("server.mjs").is_file() && candidate.join("dist").join("index.html").is_file())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "桌面资源不完整；请重新打包应用").into())
}

fn wait_until_ready(child: &mut Child, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().map_err(|e| format!("无法检查工作台服务：{e}"))? {
            return Err(format!("工作台服务启动失败（退出码 {status}）。请查看 ~/.claude/workbench-desktop.log。"));
        }
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    let _ = child.kill();
    Err("工作台服务启动超时。请查看 ~/.claude/workbench-desktop.log。".to_owned())
}

fn launch_workbench(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let node = find_node().map_err(std::io::Error::other)?;
    let root = normalize_windows_path(project_root());
    let (server_script, web_root, working_directory) = if cfg!(debug_assertions) {
        (root.join("server.mjs"), root.join("dist"), root.clone())
    } else {
        let packaged_root = packaged_workbench_root(app)?;
        (packaged_root.join("server.mjs"), packaged_root.join("dist"), packaged_root)
    };

    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);

    let claude_dir = dirs_path()?.join(".claude");
    fs::create_dir_all(&claude_dir)?;
    let log_path = claude_dir.join("workbench-desktop.log");
    {
        let mut diagnostic = OpenOptions::new().create(true).append(true).open(&log_path)?;
        writeln!(diagnostic, "desktop startup: node={:?}; server={:?}; web={:?}; cwd={:?}; port={port}", node, server_script, web_root, working_directory)?;
    }
    let log = OpenOptions::new().create(true).append(true).open(log_path)?;
    let log_err = log.try_clone()?;
    let mut child = Command::new(node)
        .arg(&server_script)
        .current_dir(working_directory)
        .env("CLAUDE_WORKBENCH_PORT", port.to_string())
        .env("CLAUDE_WORKBENCH_WEB_ROOT", &web_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .creation_flags(0x0800_0000)
        .spawn()?;

    wait_until_ready(&mut child, port).map_err(std::io::Error::other)?;
    app.manage(WorkbenchServer(Mutex::new(Some(child))));

    let url = format!("http://127.0.0.1:{port}/").parse()?;
    let window_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("")
        .theme(Some(tauri::Theme::Dark))
        .inner_size(1540.0, 960.0)
        .min_inner_size(1040.0, 680.0)
        .resizable(true)
        .icon(window_icon)?
        .build()?;
    #[cfg(windows)]
    style_title_bar(&window)?;
    Ok(())
}

#[cfg(windows)]
fn style_title_bar(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use std::ffi::c_void;
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: *mut c_void, attribute: u32, value: *const c_void, size: u32) -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, value: isize) -> isize;
        fn SendMessageW(hwnd: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
        fn SetWindowPos(hwnd: *mut c_void, after: *mut c_void, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    }
    let hwnd = window.hwnd()?.0 as *mut c_void;
    // COLORREF stores RGB bytes in reverse order. Unsupported color attributes
    // on older Windows versions fall back to the dark native window theme.
    for (attribute, value) in [(20_u32, 1_u32), (34, 0x00394241), (35, 0x00222827), (36, 0x00dee8e9)] {
        unsafe {
            DwmSetWindowAttribute(hwnd, attribute, &value as *const u32 as *const c_void, 4);
        }
    }
    // Hide only the caption icon; the large taskbar icon and native window
    // controls remain available. FRAMECHANGED applies the non-client style.
    unsafe {
        let extended_style = GetWindowLongPtrW(hwnd, -20);
        SetWindowLongPtrW(hwnd, -20, extended_style | 0x0001);
        SendMessageW(hwnd, 0x0080, 0, 0);
        SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, 0x0037);
    }
    Ok(())
}

fn dirs_path() -> Result<PathBuf, std::io::Error> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "无法找到当前 Windows 用户目录"))
}

fn stop_workbench(app: &tauri::AppHandle) {
    if let Some(server) = app.try_state::<WorkbenchServer>() {
        if let Ok(mut guard) = server.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            launch_workbench(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Claude Workbench desktop app");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_workbench(handle);
        }
    });
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;
