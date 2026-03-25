@echo off
setlocal
cd /d "%~dp0"

echo [Study Day] Stopping background automation...
call npm.cmd run study-day:stop
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [Study Day] Stop command completed.
) else (
  echo [Study Day] Stop command returned exit code %EXITCODE%.
)

echo Press any key to close this window.
pause >nul
exit /b %EXITCODE%
