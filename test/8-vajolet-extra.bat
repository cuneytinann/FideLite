@echo off
cd /d "%~dp0"

REM --- engine chosen once, here; every run below inherits it ---
set "ENGINE="
for /f "usebackq delims=" %%e in (`node test.js pick`) do set "ENGINE=%%e"
if not defined ENGINE goto cancelled

echo === Vajolet Extra Tests ===
echo Part 1: 100 pos x d4 (coverage).
echo Part 2: 10 pos x d5 (depth).
echo Part 2 is the slower half.
echo Press Ctrl+C between parts to stop.
echo Engine: %ENGINE%
echo.

echo --- Part 1/2: Vajolet 100 positions x d4 ---
node test.js vajolet 100 4

echo.
echo --- Part 2/2: Vajolet first 10 positions x d5 ---
echo Starting in 5 seconds, press Ctrl+C to stop...
timeout /t 5 /nobreak >nul
node test.js vajolet 10 5

echo.
echo ========================================
echo ALL VAJOLET EXTRA TESTS DONE.
echo ========================================
pause >nul
goto :eof

:cancelled
echo.
echo No engine selected - nothing to run.
echo (If this was not a cancel, check that Node is installed and on PATH.)
pause >nul
