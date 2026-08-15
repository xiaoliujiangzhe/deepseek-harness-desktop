' DeepSeek Harness 桌面启动器
' 双击即可启动（不会弹出黑色控制台窗口）。
Option Explicit

Dim fso, sh, scriptDir, electron, exe

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

' 以本脚本所在目录为项目根目录（无论从何处双击都有效）
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = scriptDir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
    MsgBox "未找到 Electron 运行时：" & vbCrLf & electron & vbCrLf & vbCrLf & _
           "请先双击项目里的 install.cmd 完成首次安装。", 48, "DeepSeek Harness"
    WScript.Quit 1
End If

sh.CurrentDirectory = scriptDir
sh.Run """" & electron & """ """ & scriptDir & """", 1, False
