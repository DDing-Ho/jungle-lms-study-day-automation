@echo off
setlocal
cd /d "%~dp0"

echo [Study Day] Checking background status...
call npm.cmd run study-day:status
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [Study Day] Status command completed.
) else (
  echo [Study Day] Status command returned exit code %EXITCODE%.
)

echo Press any key to close this window.
pause >nul
exit /b %EXITCODE%
