Set WshShell = CreateObject("WScript.Shell")
' Run start.bat completely invisible without flashing command prompt window
strCurDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strCurDir
WshShell.Run "cmd.exe /c """ & strCurDir & "\start.bat"" silent", 0, False
