@echo off
setlocal
cd /d "%~dp0"
set PROJECT_REF=ayuzmwpmhncxrugsyxmw
set SUPABASE_EXE=%~dp0.tools\supabase.exe

if not exist "%SUPABASE_EXE%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-supabase-cli.ps1"
)

echo.
echo Set Google Sheet webhook secrets for Supabase edge functions.
echo Use the SAME values as in your Apps Script (WEBHOOK_SECRET) and deployment URL.
echo.
set /p WEBHOOK_URL=GOOGLE_ORDER_WEBHOOK_URL (Apps Script /exec URL): 
set /p WEBHOOK_SECRET=GOOGLE_ORDER_WEBHOOK_SECRET (same as WEBHOOK_SECRET in script): 

if "%WEBHOOK_URL%"=="" (
  echo URL is required.
  pause
  exit /b 1
)

"%SUPABASE_EXE%" secrets set GOOGLE_ORDER_WEBHOOK_URL=%WEBHOOK_URL% --project-ref %PROJECT_REF%
if not "%WEBHOOK_SECRET%"=="" (
  "%SUPABASE_EXE%" secrets set GOOGLE_ORDER_WEBHOOK_SECRET=%WEBHOOK_SECRET% --project-ref %PROJECT_REF%
)

echo.
echo Secrets saved. Run deploy-functions.bat to pick up any code changes.
echo.
pause
