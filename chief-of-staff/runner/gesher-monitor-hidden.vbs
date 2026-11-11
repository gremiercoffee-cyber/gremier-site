Option Explicit

' Start Node with its console hidden and return its exit code to Task Scheduler.
Dim shell, nodePath, monitorPath, command
If WScript.Arguments.Count <> 2 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
nodePath = WScript.Arguments(0)
monitorPath = WScript.Arguments(1)
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & monitorPath & Chr(34)
WScript.Quit shell.Run(command, 0, True)
