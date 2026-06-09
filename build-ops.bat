@echo off
cd /d "%~dp0ops-app"
call npm install
call npm run build
echo.
echo Built ops app to ..\ops\
pause
