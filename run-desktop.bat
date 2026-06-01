@echo off
setlocal

pushd "%~dp0"
if errorlevel 1 goto error

if not exist package.json (
  echo Missing package.json. Run this launcher from the DustWeaver repository root.
  goto error
)

if not exist node_modules (
  echo node_modules is missing. Installing dependencies...
  call npm install
  if errorlevel 1 goto error
)

call node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.desktop ? 0 : 1)"
if errorlevel 1 goto missing_script

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\hide-launcher-console.ps1"

call npm run desktop
if errorlevel 1 goto error

popd
exit /b 0

:missing_script
echo.
echo package.json is missing the required "desktop" npm script.
echo Required script: npm run desktop
pause
popd
exit /b 1

:error
echo.
echo run-desktop.bat failed.
pause
popd
exit /b 1
