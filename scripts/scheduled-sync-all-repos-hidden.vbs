Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -NonInteractive -File ""C:\Users\srime\Documents\GitHub\DustWeaver\scripts\scheduled-sync-all-repos.ps1""", 0, True
