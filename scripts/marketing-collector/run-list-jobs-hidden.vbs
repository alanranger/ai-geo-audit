' Scheduled task "ARP Squarespace List Jobs" (every 5 min): runs run-list-jobs.cmd with no console window.
Dim dir
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "cmd.exe /c """ & dir & "\run-list-jobs.cmd""", 0, True
