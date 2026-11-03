' Запускает сервер kino скрыто (без окна консоли) и поднимает его заново, если тот упал.
' Лог: data\kino.log. Чтобы остановить насовсем, используйте stop-kino.cmd (само по себе убийство node.exe лишь перезапустит сервер).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Environment("Process")("PORT") = "80"
sh.Environment("Process")("KINO_WATCHDOG") = "1"
Do
  sh.Run "cmd /c node server\index.js >> data\kino.log 2>&1", 0, True
  WScript.Sleep 5000
Loop
