@echo off
setlocal
cd /d "%~dp0"

set PROJECT_REF=ayuzmwpmhncxrugsyxmw
set SUPABASE_EXE=%~dp0.tools\supabase.exe

if not exist "%SUPABASE_EXE%" (
  echo Downloading Supabase CLI...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-supabase-cli.ps1"
  if errorlevel 1 goto fail
)

echo.
echo Step 1 — Log in to Supabase ^(browser opens — one time only^)
echo.
"%SUPABASE_EXE%" login
if errorlevel 1 goto fail

echo.
echo Step 2 — Link this folder to your project
echo.
"%SUPABASE_EXE%" link --project-ref %PROJECT_REF%
if errorlevel 1 goto fail

echo.
echo Setup complete. Double-click deploy-functions.bat whenever you change code.
echo.
pause
exit /b 0

:fail
echo.
echo Setup did not finish. Try again.
pause
exit /b 1
