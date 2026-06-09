@echo off
setlocal
cd /d "%~dp0"
echo.
echo Test Google webhook locally (same as Supabase calls it)
echo.
set /p WEBHOOK_URL=Apps Script /exec URL: 
set /p WEBHOOK_SECRET=WEBHOOK_SECRET: 
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-google-webhook.ps1" -Url "%WEBHOOK_URL%" -Secret "%WEBHOOK_SECRET%"
echo.
pause
