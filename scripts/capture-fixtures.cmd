@echo off
node "%~dp0capture-fixtures.mjs" %*
exit /b %ERRORLEVEL%
