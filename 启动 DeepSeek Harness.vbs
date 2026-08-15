' DeepSeek Harness desktop launcher
' Double-click to launch (no console window).
Option Explicit

Dim fso, sh, scriptDir, electron

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = scriptDir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
    MsgBox "Electron runtime not found:" & vbCrLf & electron & vbCrLf & vbCrLf & _
           "Please run install.cmd first.", 48, "DeepSeek Harness"
    WScript.Quit 1
End If

sh.CurrentDirectory = scriptDir
sh.Run """" & electron & """ """ & scriptDir & """", 1, False
