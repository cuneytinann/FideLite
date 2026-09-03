@echo off
cd /d "%~dp0"
echo === Tricky Positions (with Stockfish, up to each position's published depth) ===
echo A long run. Press Ctrl+C to stop.
echo Each position has its OWN published depth (from d4 to d7).
echo The command passes d6, but positions with published depth 4 stop at d4.
echo stockfish.exe must be in this folder or on PATH.
echo.
node test.js tricky 6
echo.
echo Done. Press any key to exit...
pause >nul
