@echo off
REM Windows wrapper for scripts/audit-fixtures.sh
REM Requires Git Bash on PATH.
bash "%~dp0audit-fixtures.sh" %*
if errorlevel 1 exit /b 1
exit /b 0
