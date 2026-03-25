@echo off
setlocal
cd /d "%~dp0"

echo [Study Day] Opening manual login bootstrap...
call npm.cmd run bootstrap
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [Study Day] Bootstrap command completed.
) else (
  echo [Study Day] Bootstrap command failed with exit code %EXITCODE%.
)

echo Press any key to close this window.
pause >nul
exit /b %EXITCODE%
