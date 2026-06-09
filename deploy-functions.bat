@echo off
setlocal
cd /d "%~dp0"

set PROJECT_REF=ayuzmwpmhncxrugsyxmw
set SUPABASE_EXE=%~dp0.tools\supabase.exe

if not exist "%SUPABASE_EXE%" (
  echo.
  echo Supabase CLI not found — downloading once into .tools\ ...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-supabase-cli.ps1"
  if errorlevel 1 (
    echo Download failed.
    pause
    exit /b 1
  )
)

echo.
echo ============================================
echo  Gremier — deploy Supabase edge functions
echo  Project: %PROJECT_REF%
echo ============================================
echo.

"%SUPABASE_EXE%" functions deploy --project-ref %PROJECT_REF%
if errorlevel 1 (
  echo.
  echo Deploy failed.
  echo If you see "not logged in", double-click setup-supabase-cli.bat once.
  echo.
  pause
  exit /b 1
)

echo.
echo Done. All functions deployed — no Supabase dashboard editing needed.
echo.
pause
