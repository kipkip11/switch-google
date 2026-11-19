@echo off
chcp 65001 >nul
title Switch Google - Control Center
cd /d "%~dp0"

if "%1"=="silent" (
    powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& { & 'node' '%~dp0dist\cli.js' daemon enable; & 'node' '%~dp0dist\cli.js' daemon start }"
    exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
