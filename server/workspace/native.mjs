import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from '../core/paths.mjs';
import { safeWorkspaceRoot } from './state.mjs';
import { workspaceFileInfo, workspacePath } from './files.mjs';

// PowerShell 以 UTF-8 Base64 输出所选路径，取消时输出为空。
export function decodeFolderSelection(result) {
  const encoded = String(result.stdout || '').trim();
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8').trim() : '';
}

// 使用 IFileOpenDialog（FOS_PICKFOLDERS）弹出资源管理器风格的“打开”式文件夹选择框。
// 返回 null 表示脚本启动失败（需要回退），返回空字符串表示用户取消。
export function selectWorkspaceFolderModern() {
  // COM 接口的方法顺序必须与 ShObjIdl.h 的 vtable 完全一致，否则运行时会崩溃。
  // 这里把 IModalWindow / IFileDialog / IFileOpenDialog 的方法按顺序扁平化到单个接口：
  // Windows PowerShell 的旧版 C# 编译器下，接口继承形式会错位 vtable（实测 GetOptions 返回 E_INVALIDARG）。
  // Windows PowerShell 5.1 的 Add-Type 使用旧版 C# 编译器，代码需兼容 C# 5。
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileOpenDialog {
  // IModalWindow
  [PreserveSig] int Show(IntPtr parent);
  // IFileDialog
  [PreserveSig] int SetFileTypes(uint count, IntPtr filterSpec);
  [PreserveSig] int SetFileTypeIndex(uint index);
  [PreserveSig] int GetFileTypeIndex(out uint index);
  [PreserveSig] int Advise(IntPtr events, out uint cookie);
  [PreserveSig] int Unadvise(uint cookie);
  [PreserveSig] int SetOptions(uint options);
  [PreserveSig] int GetOptions(out uint options);
  [PreserveSig] int SetDefaultFolder(IShellItem folder);
  [PreserveSig] int SetFolder(IShellItem folder);
  [PreserveSig] int GetFolder(out IShellItem folder);
  [PreserveSig] int GetCurrentSelection(out IShellItem item);
  [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
  [PreserveSig] int GetFileName(out IntPtr name);
  [PreserveSig] int SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
  [PreserveSig] int SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
  [PreserveSig] int SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
  [PreserveSig] int GetResult(out IShellItem item);
  [PreserveSig] int AddPlace(IShellItem item, uint place);
  [PreserveSig] int SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
  [PreserveSig] int Close(int hr);
  [PreserveSig] int SetClientGuid(ref Guid guid);
  [PreserveSig] int ClearClientData();
  [PreserveSig] int SetFilter(IntPtr filter);
  // IFileOpenDialog
  [PreserveSig] int GetResults(out IntPtr results);
  [PreserveSig] int GetSelectedItems(out IntPtr items);
}

[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  [PreserveSig] int BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid iid, out IntPtr result);
  [PreserveSig] int GetParent(out IShellItem parent);
  [PreserveSig] int GetDisplayName(uint format, out IntPtr name);
  [PreserveSig] int GetAttributes(uint mask, out uint attributes);
  [PreserveSig] int Compare(IShellItem item, uint hint, out int order);
}

public static class WorkbenchFolderPicker {
  public static string Pick(string title) {
    IFileOpenDialog dialog = null;
    IShellItem item = null;
    IntPtr name = IntPtr.Zero;
    try {
      // CLSID_FileOpenDialog
      dialog = (IFileOpenDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
      uint options;
      Marshal.ThrowExceptionForHR(dialog.GetOptions(out options));
      // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
      Marshal.ThrowExceptionForHR(dialog.SetOptions(options | 0x20 | 0x40));
      Marshal.ThrowExceptionForHR(dialog.SetTitle(title));
      Marshal.ThrowExceptionForHR(dialog.SetOkButtonLabel("打开"));
      // 用户取消返回 HRESULT_FROM_WIN32(ERROR_CANCELLED)
      int hr = dialog.Show(IntPtr.Zero);
      if (hr == unchecked((int)0x800704C7)) return string.Empty;
      Marshal.ThrowExceptionForHR(hr);
      Marshal.ThrowExceptionForHR(dialog.GetResult(out item));
      // SIGDN_FILESYSPATH
      Marshal.ThrowExceptionForHR(item.GetDisplayName(0x80058000, out name));
      string path = Marshal.PtrToStringUni(name);
      return path == null ? string.Empty : path;
    } finally {
      if (name != IntPtr.Zero) Marshal.FreeCoTaskMem(name);
      if (item != null) Marshal.FinalReleaseComObject(item);
      if (dialog != null) Marshal.FinalReleaseComObject(dialog);
    }
  }
}
'@
$selected = [WorkbenchFolderPicker]::Pick('打开')
if (-not [string]::IsNullOrEmpty($selected)) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($selected)
  [Console]::Out.Write([Convert]::ToBase64String($bytes))
}
`;
  // 对话框需要可交互的 PowerShell 进程，不能加 `-NonInteractive`。
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false, timeout: 120000 });
  if (result.error || result.status !== 0) return null;
  return decodeFolderSelection(result);
}

// 旧式“浏览文件夹”树形对话框，仅在 IFileOpenDialog 脚本失败时作为回退。
export function selectWorkspaceFolderLegacy() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择 Claude Code 项目文件夹'",
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $bytes = [System.Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath); [Console]::Out.Write([Convert]::ToBase64String($bytes)) }',
  ].join('; ');
  // FolderBrowserDialog needs an interactive PowerShell process. `-NonInteractive`
  // can suppress UI behavior when the server is launched as a hidden desktop child.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false, timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error('无法打开文件夹选择窗口');
  return decodeFolderSelection(result);
}

export function selectWorkspaceFolder() {
  // 现代对话框仅在实际启动失败时回退；用户取消返回空路径，不会再弹第二个对话框。
  const modern = selectWorkspaceFolderModern();
  const selected = modern === null ? selectWorkspaceFolderLegacy() : modern;
  return selected ? safeWorkspaceRoot(selected) : '';
}

export async function revealWorkspaceFile(root, requested) {
  if (process.platform !== 'win32') throw new Error('当前平台暂不支持在资源管理器中显示文件');
  const { real } = workspacePath(root, requested);
  const stat = fs.statSync(real);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('请选择一个文件或文件夹');
  const encoded = Buffer.from(real, 'utf8').toString('base64');
  // Select through the Shell API, avoiding explorer.exe argument parsing for
  // filenames containing spaces, commas, quotes, or non-ASCII characters.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WorkbenchFileSelection {
  [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint flags);
  [DllImport("ole32.dll")] private static extern void CoUninitialize();
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SHParseDisplayName(string name, IntPtr context, out IntPtr item, uint flags, out uint attributes);
  [DllImport("shell32.dll")] private static extern int SHOpenFolderAndSelectItems(IntPtr item, uint count, IntPtr children, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int state);
  [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  public static bool Activate(IntPtr window) {
    uint own = GetCurrentThreadId();
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint target = GetWindowThreadProcessId(window, IntPtr.Zero);
    bool joinedForeground = foreground != 0 && own != foreground && AttachThreadInput(own, foreground, true);
    bool joinedTarget = target != 0 && target != foreground && own != target && AttachThreadInput(own, target, true);
    try {
      if (IsIconic(window) || !IsWindowVisible(window)) ShowWindow(window, 9);
      BringWindowToTop(window);
      SetForegroundWindow(window);
      return GetForegroundWindow() == window && IsWindowVisible(window) && !IsIconic(window);
    } finally {
      if (joinedTarget) AttachThreadInput(own, target, false);
      if (joinedForeground) AttachThreadInput(own, foreground, false);
    }
  }
  public static void Reveal(string name) {
    Marshal.ThrowExceptionForHR(CoInitializeEx(IntPtr.Zero, 2));
    IntPtr item = IntPtr.Zero;
    try {
      uint attributes;
      Marshal.ThrowExceptionForHR(SHParseDisplayName(name, IntPtr.Zero, out item, 0, out attributes));
      Marshal.ThrowExceptionForHR(SHOpenFolderAndSelectItems(item, 0, IntPtr.Zero, 0));
    } finally {
      if (item != IntPtr.Zero) Marshal.FreeCoTaskMem(item);
      CoUninitialize();
    }
  }
}
'@
$file = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$parent = [IO.Path]::GetDirectoryName($file)
$shell = New-Object -ComObject Shell.Application
function Show-WorkspaceSelection {
  foreach ($window in $shell.Windows()) {
    try {
      if ($window.Document.Folder.Self.Path -ne $parent) { continue }
      $item = $window.Document.Folder.ParseName([IO.Path]::GetFileName($file))
      if ($null -eq $item) { continue }
      $window.Document.SelectItem($item, 29)
      $selected = @($window.Document.SelectedItems() | ForEach-Object { $_.Path })
      if ($selected -contains $file) {
        if ([WorkbenchFileSelection]::Activate([IntPtr][long]$window.HWND)) { return $true }
      }
    } catch {}
  }
  return $false
}
$visibleSelection = Show-WorkspaceSelection
if (-not $visibleSelection) {
  [WorkbenchFileSelection]::Reveal($file)
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    $visibleSelection = Show-WorkspaceSelection
    if ($visibleSelection) { break }
    Start-Sleep -Milliseconds 150
  }
}
if (-not $visibleSelection) { throw 'Explorer did not display the selected file in the foreground' }
`;
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('打开资源管理器超时，请重试')); }, 15000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动系统资源管理器')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('无法在系统资源管理器中选中此文件'));
    });
  });
  return { revealed: true, fileName: path.basename(real) };
}

export async function recycleWorkspaceItem(root, requested) {
  if (process.platform !== 'win32') throw new Error('当前平台暂不支持系统回收站');
  const { project, real } = workspacePath(root, requested);
  if (real.toLowerCase() === project.toLowerCase()) throw new Error('不能将整个项目根目录移到回收站');
  const target = path.resolve(project, String(requested || '.'));
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error('暂不支持将符号链接移到回收站');
  const stat = fs.statSync(real);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('请选择一个文件或文件夹');
  const encoded = Buffer.from(real, 'utf8').toString('base64');
  const helper = fs.readFileSync(path.join(ROOT, 'scripts', 'recycle-workspace-item.ps1'), 'utf8');
  const script = helper + `\n[WorkbenchRecycle]::Move([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))\n`;
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('移到回收站超时，请刷新列表后检查文件状态')); }, 30000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动系统回收站操作')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('未能移到回收站；请关闭占用文件的程序，并确认所在磁盘支持回收站'));
    });
  });
  if (fs.existsSync(real)) throw new Error('文件仍在原位置，回收站操作未完成');
  return { recycled: true, fileName: path.basename(real) };
}

export function openWorkspaceFile(root, requested) {
  const { real } = workspaceFileInfo(root, requested);
  const encoded = Buffer.from(real, 'utf8').toString('base64');
  const script = `$file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Start-Process -FilePath $file`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) throw new Error('无法用系统默认程序打开此文件');
  return { opened: true, fileName: path.basename(real) };
}

export function readWorkspaceClipboard() {
  if (process.platform !== 'win32') throw new Error('当前平台暂不支持读取系统剪贴板');
  const imageDirectory = path.join(os.tmpdir(), 'ClaudeWorkbenchClipboard');
  fs.mkdirSync(imageDirectory, { recursive: true });
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(imageDirectory)) {
      if (!/^(?:clipboard|attachment)-[0-9a-f-]+\.(?:png|jpe?g|gif|webp)$/i.test(name)) continue;
      const file = path.join(imageDirectory, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch {}
  const imagePath = path.join(imageDirectory, `clipboard-${crypto.randomUUID()}.png`);
  const encodedImagePath = Buffer.from(imagePath, 'utf8').toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$data = [Windows.Forms.Clipboard]::GetDataObject()',
    `$imagePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedImagePath}'))`,
    "$result = [ordered]@{ text = ''; files = @(); image = $false; imagePath = '' }",
    'if ($null -ne $data) {',
    'if ($data.GetDataPresent([Windows.Forms.DataFormats]::UnicodeText)) { $result.text = [string]$data.GetData([Windows.Forms.DataFormats]::UnicodeText) } elseif ($data.GetDataPresent([Windows.Forms.DataFormats]::Text)) { $result.text = [string]$data.GetData([Windows.Forms.DataFormats]::Text) }',
    'if ($data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) { $result.files = @($data.GetData([Windows.Forms.DataFormats]::FileDrop)) }',
    "$formats = @($data.GetFormats()); $result.image = [bool]($formats | Where-Object { $_ -match '^(Bitmap|DeviceIndependentBitmap|PNG|DIB|image/)' } | Select-Object -First 1); if ($result.image) { $image = [Windows.Forms.Clipboard]::GetImage(); if ($null -ne $image) { $image.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Png); $image.Dispose(); $result.imagePath = $imagePath } }",
    '}',
    '$json = ConvertTo-Json -InputObject $result -Compress -Depth 4',
    '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))',
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], { windowsHide: true });
    const stdout = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('读取剪贴板超时，请再试一次')); }, 5000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { child.kill(); clearTimeout(timer); reject(new Error('剪贴板内容过大')); return; }
      stdout.push(chunk);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 Windows 剪贴板读取器')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('无法读取 Windows 剪贴板')); return; }
      const encoded = Buffer.concat(stdout).toString('utf8').trim();
      if (!encoded) { reject(new Error('Windows 剪贴板没有返回数据')); return; }
      try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        resolve({
          text: typeof parsed.text === 'string' ? parsed.text : '',
          files: Array.isArray(parsed.files) ? parsed.files.filter(x => typeof x === 'string') : [],
          image: parsed.image === true,
          imagePath: typeof parsed.imagePath === 'string' && fs.existsSync(parsed.imagePath) ? parsed.imagePath : '',
        });
      } catch {
        reject(new Error('Windows 剪贴板返回了无法识别的数据'));
      }
    });
  });
}
