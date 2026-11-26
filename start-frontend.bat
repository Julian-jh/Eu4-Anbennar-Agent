@echo off
setlocal
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    py -3 "%~dp0scripts\serve_frontend.py"
    goto finished
)
python -c "import sys; sys.exit(sys.version_info.major != 3)" >nul 2>&1
if not errorlevel 1 (
    python "%~dp0scripts\serve_frontend.py"
    goto finished
)
echo Python 3 is required. Install Python 3 and run this launcher again.
pause
exit /b 1

:finished
if not errorlevel 1 exit /b 0
pause
exit /b 1
