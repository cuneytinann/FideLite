@echo off
cd /d "%~dp0"

REM --- engine chosen once, here; every run below inherits it ---
set "ENGINE="
for /f "usebackq delims=" %%e in (`node test.js pick`) do set "ENGINE=%%e"
if not defined ENGINE goto cancelled

echo === CPW Extra Deep Tests (Pos3 d6+d7, Start d6) ===
echo In order: Pos3 d6, Start d6, Pos3 d7.
echo Pos3 d6 is the quickest of the three; Pos3 d7 is by far the longest.
echo A 5-second Ctrl+C window before each test.
echo Engine: %ENGINE%
echo.

echo --- 1/3: Position 3 d6 ---
echo Expected: 11,030,083
node test.js pos pos3 6
echo.

echo --- 2/3: Start d6 ---
echo Expected: 119,060,324
echo Starting in 5 seconds, press Ctrl+C to stop...
timeout /t 5 /nobreak >nul
node test.js pos start 6
echo.

echo --- 3/3: Position 3 d7 ---
echo Expected: 178,633,661
echo Starting in 5 seconds, press Ctrl+C to stop...
timeout /t 5 /nobreak >nul
node test.js pos pos3 7
echo.

echo ========================================
echo ALL EXTRA TESTS DONE.
echo ========================================
pause >nul
goto :eof

:cancelled
echo.
echo No engine selected - nothing to run.
echo (If this was not a cancel, check that Node is installed and on PATH.)
pause >nul
