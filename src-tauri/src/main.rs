#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::Write,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct WorkbenchServer(Mutex<Option<Child>>);

/// 服务进程的完整启动参数：守护线程重启服务时按原样重建
#[derive(Clone)]
struct ServerSpec {
    node: PathBuf,
    server_script: PathBuf,
    web_root: PathBuf,
    working_directory: PathBuf,
    port: u16,
    log_path: PathBuf,
}

/// 守护线程停止信号；应用退出时置位，避免关机流程与守护重启互相竞争
static SERVER_GUARD_SHUTDOWN: AtomicBool = AtomicBool::new(false);

/// 守护线程连续重启失败上限；超过后停止重启并记录日志，等待用户手动重启应用
const SERVER_RESTART_LIMIT: u32 = 3;

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

fn append_server_log(log_path: &Path, message: &str) {
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(log, "{message}");
    }
}

/// 按参数启动工作台服务并等待端口就绪；端口被占用时返回错误，由调用方记录
fn spawn_server(spec: &ServerSpec) -> Result<Child, String> {
    // 启动前确认端口可用，失败时给出明确原因而不是等待超时
    TcpListener::bind(("127.0.0.1", spec.port)).map_err(|e| format!("端口 {} 不可用：{e}", spec.port))?;
    let log = OpenOptions::new().create(true).append(true).open(&spec.log_path)
        .map_err(|e| format!("无法打开服务日志：{e}"))?;
    let log_err = log.try_clone().map_err(|e| format!("无法复制服务日志句柄：{e}"))?;
    let mut child = Command::new(&spec.node)
        .arg(&spec.server_script)
        .current_dir(&spec.working_directory)
        .env("CLAUDE_WORKBENCH_PORT", spec.port.to_string())
        .env("CLAUDE_WORKBENCH_WEB_ROOT", &spec.web_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| format!("无法启动工作台服务：{e}"))?;
    wait_until_ready(&mut child, spec.port)?;
    Ok(child)
}

/// 服务守护线程：node 进程意外退出时按原参数自动重启，保证界面无需手动重启应用
fn guard_server(app: tauri::AppHandle, spec: ServerSpec) {
    let mut restarts: u32 = 0;
    while !SERVER_GUARD_SHUTDOWN.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_secs(3));
        if SERVER_GUARD_SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }
        let exited = {
            let server = app.state::<WorkbenchServer>();
            let mut guard = match server.0.lock() {
                Ok(guard) => guard,
                Err(_) => continue,
            };
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(_status)) => {
                        // 进程已退出：清空槽位，交由下方重启
                        *guard = None;
                        true
                    }
                    Ok(None) => false,
                    Err(error) => {
                        append_server_log(&spec.log_path, &format!("server guard: 检查服务状态失败：{error}"));
                        false
                    }
                },
                None => false,
            }
        };
        if !exited {
            restarts = 0;
            continue;
        }
        if restarts >= SERVER_RESTART_LIMIT {
            append_server_log(&spec.log_path, "server guard: 连续重启失败次数达上限，停止自动重启；请手动重启应用");
            break;
        }
        restarts += 1;
        append_server_log(&spec.log_path, &format!("server guard: 检测到工作台服务退出，正在自动重启（第 {restarts} 次）"));
        match spawn_server(&spec) {
            Ok(child) => {
                let server = app.state::<WorkbenchServer>();
                if let Ok(mut guard) = server.0.lock() {
                    *guard = Some(child);
                }
                restarts = 0;
                append_server_log(&spec.log_path, "server guard: 工作台服务已自动恢复");
            }
            Err(error) => append_server_log(&spec.log_path, &format!("server guard: 自动重启失败：{error}")),
        }
    }
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

    let spec = ServerSpec {
        node,
        server_script,
        web_root,
        working_directory,
        port,
        log_path: log_path.clone(),
    };
    let child = spawn_server(&spec).map_err(std::io::Error::other)?;
    app.manage(WorkbenchServer(Mutex::new(Some(child))));

    // 启动服务守护线程：node 意外退出时自动按原参数重启
    {
        let guard_app = app.clone();
        let guard_spec = spec.clone();
        thread::spawn(move || guard_server(guard_app, guard_spec));
    }

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
    // 先通知守护线程停止，避免退出流程与自动重启互相竞争
    SERVER_GUARD_SHUTDOWN.store(true, Ordering::SeqCst);
    if let Some(server) = app.try_state::<WorkbenchServer>() {
        if let Ok(mut guard) = server.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Windows 命名互斥体：已有应用实例运行时静默退出，避免多窗口/旧窗口并存造成"切换目录无反应"的假象
#[cfg(windows)]
fn ensure_single_instance() {
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *mut std::ffi::c_void, initial_owner: i32, name: *const u16) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    let name: Vec<u16> = "Global\\ClaudeWorkbenchDesktopSingleInstance\0"
        .encode_utf16()
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
    // 句柄需要存活到进程退出，防止互斥体被提前释放；泄漏一个内核句柄无实际影响
    std::mem::forget(handle);
    if !handle.is_null() && unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        std::process::exit(0);
    }
}

fn main() {
    #[cfg(windows)]
    ensure_single_instance();
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
