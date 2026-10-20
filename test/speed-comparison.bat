@echo off
REM Double-click this file to compare the speed of the three engines in this folder.
cd /d "%~dp0"
chcp 65001 >nul
echo === FideLite Speed Comparison ===
echo engine.js, engine_string.js and engine_4x.js count every move sequence to
echo depth 4 from the six CPW positions, each through its own move generator.
echo engine.js is the baseline. Every engine runs in its own process each round,
echo the median round is reported and every node count is checked.
echo One round takes roughly 15-20 minutes on a recent laptop; close other programs.
echo.
set "R="
set /p "R=Rounds [3]: "
if "%R%"=="" set R=3
echo.
start "" /b /high /wait node bench.js engine.js engine_string.js engine_4x.js --rounds=%R%
echo.
echo Done. The report is also saved in the results folder. Press any key to continue...
pause >nul
