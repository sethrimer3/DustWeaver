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

call node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.dev ? 0 : 1)"
if errorlevel 1 goto missing_script

call npm run dev
if errorlevel 1 goto error

popd
exit /b 0

:missing_script
echo.
echo package.json is missing the required "dev" npm script.
echo Required script: npm run dev
pause
popd
exit /b 1

:error
echo.
echo run-browser-dev.bat failed.
pause
popd
exit /b 1
