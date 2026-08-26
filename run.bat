@echo off
title SkyFilter Pro - Excel Multi-Sheet UID Splitter & Dead Row Remover
color 0b
echo ======================================================================
echo           ?? SKYFILTER PRO - ADVANCED EXCEL MANAGEMENT SUITE ??
echo ======================================================================
echo.
echo   [+] Starting SkyFilter Pro Server on Port 3000...
echo   [+] Opening Dashboard at: http://localhost:3000
echo   [+] Ultra Fast Engine & Full Dead Row Purge System
echo.
echo ======================================================================
cd /d "%~dp0"
python server.py 3000
pause