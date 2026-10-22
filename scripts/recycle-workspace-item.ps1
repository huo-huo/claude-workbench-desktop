$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.IO;
using System.Runtime.InteropServices;

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IWorkbenchShellItem { }

// Method order follows the Windows IFileOperation vtable.
[ComImport, Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IWorkbenchFileOperation {
  [PreserveSig] int Advise(IntPtr sink, out uint cookie);
  [PreserveSig] int Unadvise(uint cookie);
  [PreserveSig] int SetOperationFlags(uint flags);
  [PreserveSig] int SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string message);
  [PreserveSig] int SetProgressDialog(IntPtr dialog);
  [PreserveSig] int SetProperties(IntPtr properties);
  [PreserveSig] int SetOwnerWindow(IntPtr owner);
  [PreserveSig] int ApplyPropertiesToItem(IWorkbenchShellItem item);
  [PreserveSig] int ApplyPropertiesToItems(IntPtr items);
  [PreserveSig] int RenameItem(IWorkbenchShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr sink);
  [PreserveSig] int RenameItems(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string name);
  [PreserveSig] int MoveItem(IWorkbenchShellItem item, IWorkbenchShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr sink);
  [PreserveSig] int MoveItems(IntPtr items, IWorkbenchShellItem destination);
  [PreserveSig] int CopyItem(IWorkbenchShellItem item, IWorkbenchShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr sink);
  [PreserveSig] int CopyItems(IntPtr items, IWorkbenchShellItem destination);
  [PreserveSig] int DeleteItem(IWorkbenchShellItem item, IntPtr sink);
  [PreserveSig] int DeleteItems(IntPtr items);
  [PreserveSig] int NewItem(IWorkbenchShellItem destination, uint attributes, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, IntPtr sink);
  [PreserveSig] int PerformOperations();
  [PreserveSig] int GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool aborted);
}

public static class WorkbenchRecycle {
  [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved, uint flags);
  [DllImport("ole32.dll")] static extern void CoUninitialize();
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHCreateItemFromParsingName(string name, IntPtr context, ref Guid iid, out IWorkbenchShellItem item);

  public static void Move(string name) {
    // Windows Recycle Bin semantics require a local fixed volume.
    if (new DriveInfo(Path.GetPathRoot(name)).DriveType != DriveType.Fixed)
      throw new NotSupportedException("This volume does not support the local Recycle Bin");
    Marshal.ThrowExceptionForHR(CoInitializeEx(IntPtr.Zero, 2));
    IWorkbenchShellItem item = null;
    IWorkbenchFileOperation operation = null;
    try {
      Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
      Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(name, IntPtr.Zero, ref iid, out item));
      operation = (IWorkbenchFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3AD05575-8857-4850-9277-11B85BDB8E09")));
      // RECYCLEONDELETE + ADDUNDORECORD + EARLYFAILURE, silent/no-error UI.
      // No permanent-delete fallback is used.
      Marshal.ThrowExceptionForHR(operation.SetOperationFlags(0x20180454));
      Marshal.ThrowExceptionForHR(operation.DeleteItem(item, IntPtr.Zero));
      Marshal.ThrowExceptionForHR(operation.PerformOperations());
      bool aborted;
      Marshal.ThrowExceptionForHR(operation.GetAnyOperationsAborted(out aborted));
      if (aborted) throw new OperationCanceledException("Recycle operation aborted");
    } finally {
      if (operation != null) Marshal.FinalReleaseComObject(operation);
      if (item != null) Marshal.FinalReleaseComObject(item);
      CoUninitialize();
    }
  }
}
'@
