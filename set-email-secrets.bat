@echo off
setlocal
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
echo 1. Sign up at https://resend.com (free tier is fine)
echo 2. Create an API key
echo 3. Optional: verify your domain for FROM address
echo    Or use onboarding@resend.dev for testing (Resend default)
echo.

set /p RESEND_KEY=RESEND_API_KEY: 
set /p NOTIFY=NOTIFY_EMAIL (default gremiercoffee@gmail.com): 
if "%NOTIFY%"=="" set NOTIFY=gremiercoffee@gmail.com
set /p FROM=ORDER_EMAIL_FROM (optional, e.g. Gremier ^<orders@yourdomain.com^>): 

"%SUPABASE_EXE%" secrets set RESEND_API_KEY=%RESEND_KEY% NOTIFY_EMAIL=%NOTIFY% --project-ref %PROJECT_REF%
if not "%FROM%"=="" (
  "%SUPABASE_EXE%" secrets set ORDER_EMAIL_FROM=%FROM% --project-ref %PROJECT_REF%
)

echo.
echo Done. Run deploy-functions.bat to apply.
echo Google Sheet webhook secrets are still set separately (set-google-webhook-secrets.bat).
echo.
pause
