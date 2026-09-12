@echo off
setlocal EnableDelayedExpansion
title YARDOS - stop

REM ===================================================================
REM  YARDOS - stop the local development stack.
REM
REM  Ends the API and console servers, then stops the Docker services.
REM  Database contents are PRESERVED: containers are stopped, not
REM  removed, and volumes are never touched here. Use
REM  "start.bat --reset" if you actually want a clean database.
REM
REM  Usage:
REM    stop.bat            stop the servers and the Docker services
REM    stop.bat --apps     stop only the servers, leave Docker running
REM    stop.bat --force    also kill any stray node process on 3000/3001
REM ===================================================================

cd /d "%~dp0"

set "APPS_ONLY=0"
set "FORCE=0"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--apps"  set "APPS_ONLY=1"
if /i "%~1"=="--force" set "FORCE=1"
if /i "%~1"=="--help"  goto usage
if /i "%~1"=="-h"      goto usage
shift
goto parse_args
:args_done

echo.
echo  ==========================================================
echo    YARDOS - stopping
echo  ==========================================================
echo.

REM ---------------------------------------------------------------
REM  1. The servers started by start.bat
REM
REM  /T kills the whole tree. npm spawns the real node process as a
REM  child, so killing the recorded PID alone would leave node running
REM  and the port still bound.
REM ---------------------------------------------------------------
call :stop_pid "API"     ".run\api.pid"
call :stop_pid "Console" ".run\web.pid"

REM ---------------------------------------------------------------
REM  2. Anything still holding the ports
REM
REM  Covers servers started by hand with `npm run dev`, which leave no
REM  pid file. Only ports 3000 and 3001 are considered, and only
REM  LISTENING sockets, so an unrelated program is not caught.
REM ---------------------------------------------------------------
if "%FORCE%"=="1" (
  call :free_port 3000 "API"
  call :free_port 3001 "Console"
) else (
  call :warn_port 3000 "API"
  call :warn_port 3001 "Console"
)

REM ---------------------------------------------------------------
REM  3. Docker services
REM ---------------------------------------------------------------
if "%APPS_ONLY%"=="1" (
  echo  [--] Leaving Docker services running ^(--apps^)
) else (
  where docker >nul 2>&1
  if errorlevel 1 (
    echo  [--] Docker not on PATH - nothing to stop
  ) else (
    docker info >nul 2>&1
    if errorlevel 1 (
      echo  [--] Docker engine not running - nothing to stop
    ) else (
      echo  Stopping PostgreSQL, Redis and MinIO...
      REM `stop`, not `down`: containers and named volumes both survive,
      REM so the next start is fast and the data is still there.
      REM --env-file .env so this addresses the same containers start.bat
      REM created; without it Compose resolves different published ports.
      docker compose --env-file .env -f docker/docker-compose.yml stop >nul 2>&1
      if errorlevel 1 (
        echo  [warn] Could not stop the Docker services cleanly.
        echo      Try: docker compose --env-file .env -f docker/docker-compose.yml stop
      ) else (
        echo  [ok] Docker services stopped ^(data preserved^)
      )
    )
  )
)

echo.
echo  ==========================================================
echo    YARDOS stopped
echo  ==========================================================
echo.
echo    Database contents were preserved.
echo    Start again with:  start.bat
echo.
endlocal
exit /b 0

REM ===================================================================
REM  Helpers
REM ===================================================================

:stop_pid
REM  %~1 friendly name, %~2 pid file
if not exist "%~2" (
  echo  [--] %~1: no recorded process
  exit /b 0
)
set "PID="
set /p PID=<"%~2"
if "!PID!"=="" (
  del /q "%~2" >nul 2>&1
  echo  [--] %~1: empty pid file
  exit /b 0
)

tasklist /FI "PID eq !PID!" 2>nul | find "!PID!" >nul
if errorlevel 1 (
  echo  [--] %~1: process !PID! already gone
  del /q "%~2" >nul 2>&1
  exit /b 0
)

taskkill /PID !PID! /T /F >nul 2>&1
if errorlevel 1 (
  echo  [warn] %~1: could not stop process !PID!
) else (
  echo  [ok] %~1 stopped ^(pid !PID!^)
)
del /q "%~2" >nul 2>&1
exit /b 0

:warn_port
REM  %~1 port, %~2 friendly name - report only
set "HELD="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":%~1 "') do set "HELD=%%p"
if defined HELD (
  echo  [warn] Port %~1 ^(%~2^) is still held by pid !HELD!
  echo      It was not started by start.bat. Stop it with: stop.bat --force
)
exit /b 0

:free_port
REM  %~1 port, %~2 friendly name - kill the listener
set "HELD="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":%~1 "') do set "HELD=%%p"
if not defined HELD (
  echo  [--] Port %~1 ^(%~2^) already free
  exit /b 0
)
taskkill /PID !HELD! /T /F >nul 2>&1
if errorlevel 1 (
  echo  [warn] Could not free port %~1 ^(pid !HELD!^)
) else (
  echo  [ok] Freed port %~1 ^(%~2, pid !HELD!^)
)
exit /b 0

:usage
echo.
echo  Usage: stop.bat [options]
echo.
echo    --apps    Stop only the API and console, leave Docker running
echo    --force   Also kill whatever is listening on ports 3000 and 3001
echo    --help    Show this message
echo.
endlocal
exit /b 0
