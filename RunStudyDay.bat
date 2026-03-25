@echo off
setlocal
cd /d "%~dp0"

echo [Study Day] Starting Jungle LMS day automation...
call npm.cmd run study-day
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [Study Day] Command completed.
) else (
  echo [Study Day] Command failed with exit code %EXITCODE%.
)

echo Press any key to close this window.
pause >nul
exit /b %EXITCODE%
