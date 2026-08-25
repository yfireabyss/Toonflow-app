' Toonflow auto-start launcher (hidden window, log redirected to logs\serve.log)
' Used by scheduled task Toonflow_AutoStart (ONLOGON).
Option Explicit
Dim ws, cmd
Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = "E:\94-Toonflow"
cmd = "cmd /c ""C:\Program Files\nodejs\node.exe"" data/serve/app.js >> logs\serve.log 2>&1"
ws.Run cmd, 0, False
