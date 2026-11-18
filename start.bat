@echo off
chcp 65001 >nul
title Switch Google - Control Center
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
