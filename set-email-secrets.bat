@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set PROJECT_REF=ayuzmwpmhncxrugsyxmw
set SUPABASE_EXE=%~dp0.tools\supabase.exe

if not exist "%SUPABASE_EXE%" (
  echo Run setup-supabase-cli.bat first.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Gremier — order email secrets (Resend)
echo ============================================
echo.
echo Required:
echo   RESEND_API_KEY  — from https://resend.com/api-keys
echo   NOTIFY_EMAIL    — where YOU get alerts (gremiercoffee@gmail.com)
echo.
echo ORDER_EMAIL_FROM — the "From" address customers see (must be verified in Resend):
echo   - Resend CANNOT send from @gmail.com
echo   - Add your domain in Resend, then use e.g. orders@yourdomain.com
echo   - For testing only: Gremier Coffee ^<onboarding@resend.dev^>
echo   - Wrap in quotes if it contains spaces
echo.

set /p RESEND_KEY=RESEND_API_KEY: 
set /p NOTIFY=NOTIFY_EMAIL (default gremiercoffee@gmail.com): 
if "%NOTIFY%"=="" set NOTIFY=gremiercoffee@gmail.com
set /p FROM=ORDER_EMAIL_FROM (Enter for onboarding@resend.dev): 
if "%FROM%"=="" set FROM=Gremier Coffee ^<onboarding@resend.dev^>

echo.
echo Setting secrets...

"%SUPABASE_EXE%" secrets set "RESEND_API_KEY=%RESEND_KEY%" --project-ref %PROJECT_REF%
if errorlevel 1 goto :failed

"%SUPABASE_EXE%" secrets set "NOTIFY_EMAIL=%NOTIFY%" --project-ref %PROJECT_REF%
if errorlevel 1 goto :failed

"%SUPABASE_EXE%" secrets set "ORDER_EMAIL_FROM=%FROM%" --project-ref %PROJECT_REF%
if errorlevel 1 goto :failed

echo.
echo Done. Run deploy-functions.bat to apply.
echo Google Sheet is optional — remove GOOGLE_ORDER_WEBHOOK_URL secret if you are not using it.
echo.
pause
exit /b 0

:failed
echo.
echo Failed. Set secrets in Supabase Dashboard:
echo   Project Settings ^> Edge Functions ^> Secrets
echo.
pause
exit /b 1
