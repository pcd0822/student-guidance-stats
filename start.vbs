' Student guidance stats - start without a console window (Windows). ASCII only on purpose.
' The desktop shortcut runs this file with wscript.exe.
' - Ready (.venv has pythonw.exe): run the app window with no console.
'   The app itself hands over to start.bat when packages must be installed or the app window cannot open.
' - Not ready yet (first run): run start.bat in a normal window so setup progress and errors are visible.
Option Explicit
Dim fso, sh, root, pyw
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
sh.Environment("PROCESS")("PYTHONUTF8") = "1"
pyw = root & "\.venv\Scripts\pythonw.exe"
If fso.FileExists(pyw) Then
  sh.Run """" & pyw & """ -m app --launcher", 0, False
Else
  sh.Run """" & root & "\start.bat""", 1, False
End If
