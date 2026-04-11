@echo off
REM Windows wrapper for scripts/validate-schema-py.sh
REM Requires Git Bash (bash.exe on PATH) or WSL.
bash "%~dp0validate-schema-py.sh" %*
if errorlevel 1 exit /b 1
exit /b 0
