@echo off
setlocal
cd /d "%~dp0"

set SUPABASE_EXE=%~dp0.tools\supabase.exe
if not exist "%SUPABASE_EXE%" (
  echo Supabase CLI not found. Run setup-supabase-cli.bat first.
  pause
  exit /b 1
)

echo Applying database migrations to Supabase...
echo.
"%SUPABASE_EXE%" db push
if errorlevel 1 (
  echo.
  echo Migration failed. You can also run this SQL in Supabase Dashboard ^> SQL Editor:
  echo   ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS delivery_address text;
  echo.
  pause
  exit /b 1
)

echo.
echo Migrations applied.
pause
exit /b 0
