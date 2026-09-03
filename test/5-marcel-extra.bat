@echo off
cd /d "%~dp0"
echo === Marcel Tricky Extra Deep Tests (with Stockfish) ===
echo Beyond published depth - cross-checked with Stockfish.
echo Ordered fastest to slowest. Press Ctrl+C to stop.
echo stockfish.exe required.
echo.

echo --- 1/10: Self Stalemate d8 ---
node test.js verify "K1k5/8/P7/8/8/8/8/8 w - - 0 1" 8

echo --- 2/10: Stalemate Mate I d8 ---
node test.js verify "8/k1P5/8/1K6/8/8/8/8 w - - 0 1" 8

echo --- 3/10: Under Promote d8 ---
node test.js verify "8/P1k5/K7/8/8/8/8/8 w - - 0 1" 8

echo --- 4/10: Promote to check d8 ---
node test.js verify "4k3/1P6/8/8/8/8/K7/8 w - - 0 1" 8

echo --- 5/10: Short castling check d7 ---
node test.js verify "5k2/8/8/8/8/8/8/4K2R w K - 0 1" 7

echo --- 6/10: Long castling check d7 ---
node test.js verify "3k4/8/8/8/8/8/8/R3K3 w Q - 0 1" 7

echo --- 7/10: Bishop pin avoid d6 ---
node test.js verify "1k6/1b6/8/8/7R/8/8/4K2R b K - 0 1" 6

echo --- 8/10: Discovered Check d6 ---
node test.js verify "8/8/1P2K3/8/2n5/1q6/8/5k2 b - - 0 1" 6

echo --- 9/10: Castle Rights d5 ---
node test.js verify "r3k2r/1b4bq/8/8/8/8/7B/R3K2R w KQkq - 0 1" 5

echo --- 10/10: Castling Prevented d5 ---
node test.js verify "r3k2r/8/3Q4/8/8/5q2/8/R3K2R b KQkq - 0 1" 5

echo.
echo ========================================
echo ALL MARCEL EXTRA TESTS DONE.
echo ========================================
pause >nul
