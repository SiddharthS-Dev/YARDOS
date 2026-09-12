@echo off
setlocal EnableDelayedExpansion
title YARDOS - start

REM ===================================================================
REM  YARDOS - start the full local development stack.
REM
REM  Brings up PostgreSQL, Redis and MinIO in Docker, prepares the
REM  database, then starts the API and the console in their own windows
REM  so their logs stay readable.
REM
REM  Usage:
REM    start.bat              normal start
REM    start.bat --seed       start and re-seed the demo data
REM    start.bat --reset      DESTROY the database and start fresh
REM    start.bat --no-docker  skip Docker (services already running)
REM
REM  Stop everything again with stop.bat
REM
REM  Two batch details worth knowing before editing this file:
REM
REM    Waiting uses `ping`, not `timeout`. `timeout` needs a real
REM    console and aborts with "Input redirection is not supported"
REM    whenever the script is piped or run from another tool - which
REM    silently turns every wait loop into a busy spin.
REM
REM    Loops live in subroutines called with CALL, never as GOTO labels
REM    inside a parenthesised IF block. Jumping out of such a block
REM    leaves cmd's parser mid-block, and the ELSE branch then runs too.
REM ===================================================================

cd /d "%~dp0"

set "SEED=0"
set "RESET=0"
set "USE_DOCKER=1"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--seed"      set "SEED=1"
if /i "%~1"=="--reset"     set "RESET=1"
if /i "%~1"=="--no-docker" set "USE_DOCKER=0"
if /i "%~1"=="--help"      goto usage
if /i "%~1"=="-h"          goto usage
shift
goto parse_args
:args_done

echo.
echo  ==========================================================
echo    YARDOS - Vehicle Yard Operating System
echo    Starting local development stack
echo  ==========================================================
echo.

REM ---------------------------------------------------------------
REM  1. Prerequisites
REM ---------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js is not on PATH.
  echo      Install Node 20.11 or newer from https://nodejs.org
  goto fail
)
for /f "tokens=*" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo  [ok] Node !NODE_VERSION!

REM curl.exe ships on Windows 10 1803 and later. Older machines fall back to
REM a PowerShell probe.
where curl.exe >nul 2>&1
if errorlevel 1 set "NO_CURL=1"

if "%USE_DOCKER%"=="1" call :check_docker
if errorlevel 1 goto fail

REM ---------------------------------------------------------------
REM  2. Environment file
REM
REM  .env is git-ignored and holds local credentials. .env.example
REM  carries clearly-marked placeholders and is safe to copy for
REM  development; the API refuses to boot with those values when
REM  NODE_ENV=production.
REM ---------------------------------------------------------------
if exist ".env" (
  echo  [ok] .env present
) else (
  if not exist ".env.example" (
    echo  [X] Neither .env nor .env.example is present. Is this the repo root?
    goto fail
  )
  copy /y ".env.example" ".env" >nul
  echo  [ok] Created .env from .env.example
  echo       NOTE: it holds DEVELOPMENT placeholders, not real secrets.
)

REM ---------------------------------------------------------------
REM  3. Dependencies
REM ---------------------------------------------------------------
if exist "node_modules" (
  echo  [ok] Dependencies present
) else (
  echo.
  echo  Installing dependencies. The first run takes a few minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [X] npm install failed.
    goto fail
  )
  echo  [ok] Dependencies installed
)

REM ---------------------------------------------------------------
REM  4. Backing services
REM ---------------------------------------------------------------
if "%USE_DOCKER%"=="1" (
  call :start_services
  if errorlevel 1 goto fail
) else (
  echo  [--] Skipping Docker ^(--no-docker^)
)

REM ---------------------------------------------------------------
REM  5. Build shared contracts and generate the Prisma client
REM
REM  Both are generated code the API imports. It will not compile
REM  without them, and neither is committed.
REM ---------------------------------------------------------------
echo.
echo  Building shared contracts...
call npm run build --workspace=@smartpark/contracts >nul 2>&1
if errorlevel 1 (
  echo  [X] Contracts build failed. Run it directly to see why:
  echo      npm run build --workspace=@smartpark/contracts
  goto fail
)
echo  [ok] Contracts built

echo  Generating Prisma client...
call npm run db:generate --workspace=@smartpark/api >nul 2>&1
if errorlevel 1 (
  echo  [X] Prisma generate failed. Run it directly to see why:
  echo      npm run db:generate --workspace=@smartpark/api
  goto fail
)
echo  [ok] Prisma client generated

REM ---------------------------------------------------------------
REM  6. Migrations
REM ---------------------------------------------------------------
echo  Applying database migrations...
call npm run db:deploy --workspace=@smartpark/api >nul 2>&1
if errorlevel 1 (
  echo  [X] Migrations failed. Run it directly to see why:
  echo      npm run db:deploy --workspace=@smartpark/api
  goto fail
)
echo  [ok] Migrations applied

REM ---------------------------------------------------------------
REM  7. Seed
REM
REM  Only when asked, or when the database has no organisation row.
REM  The seed truncates before inserting, so running it against a
REM  populated database would discard real local work.
REM ---------------------------------------------------------------
if "%SEED%"=="0" if "%USE_DOCKER%"=="1" call :detect_empty_database

if "%SEED%"=="1" (
  echo  Seeding demo data...
  call npm run db:seed --workspace=@smartpark/api
  if errorlevel 1 (
    echo  [X] Seeding failed.
    goto fail
  )
  echo  [ok] Demo data seeded
) else (
  echo  [ok] Database already populated - not reseeding
)

REM ---------------------------------------------------------------
REM  8. Start the application
REM
REM  Each server runs in its own window so its logs stay readable, and
REM  its PID is recorded so stop.bat can end the whole process tree.
REM  npm wraps the real node process as a child, so killing the
REM  recorded PID alone would orphan node and leave the port bound.
REM ---------------------------------------------------------------
REM The MinIO console port is overridable, so read it back rather than
REM printing a number that may not be the one Compose published.
set "MINIO_CONSOLE=9001"
for /f "usebackq tokens=2 delims==" %%v in (`findstr /b /c:"MINIO_CONSOLE_PORT=" ".env"`) do set "MINIO_CONSOLE=%%v"

if not exist ".run" mkdir ".run"

echo.
echo  Starting the API on http://localhost:3000 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','title YARDOS API && npm run dev --workspace=@smartpark/api' -WorkingDirectory '%CD%' -PassThru; $p.Id | Out-File -Encoding ascii -NoNewline '.run\api.pid'"

echo  Starting the console on http://localhost:3001 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','title YARDOS Console && npm run dev --workspace=@smartpark/web' -WorkingDirectory '%CD%' -PassThru; $p.Id | Out-File -Encoding ascii -NoNewline '.run\web.pid'"

call :wait_for_api

echo.
echo  ==========================================================
echo    YARDOS is running
echo  ==========================================================
echo.
echo    Console        http://localhost:3001
echo    API            http://localhost:3000/api/v1
echo    API docs       http://localhost:3000/docs
echo    Health         http://localhost:3000/health
echo    MinIO console  http://localhost:!MINIO_CONSOLE!
echo.
echo    The console compiles on first request, so the first page
echo    load takes appreciably longer than later ones.
echo.
echo    Sign-in accounts and passwords are printed by the seed step
echo    and are listed in apps/api/prisma/seed.ts.
echo.
echo    Two server windows are now open. Closing THIS window does
echo    not stop them.
echo.
echo    To stop everything:  stop.bat
echo.
goto end

REM ===================================================================
REM  Subroutines
REM ===================================================================

:check_docker
where docker >nul 2>&1
if errorlevel 1 (
  echo  [X] Docker is not on PATH.
  echo      Install Docker Desktop, or pass --no-docker if PostgreSQL,
  echo      Redis and MinIO are already running elsewhere.
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo  [X] Docker is installed but not running.
  echo      Start Docker Desktop, wait for "Engine running", and retry.
  exit /b 1
)
echo  [ok] Docker engine reachable
exit /b 0

:start_services
if "%RESET%"=="1" (
  echo.
  echo  **********************************************************
  echo    --reset will DELETE the local database, including every
  echo    vehicle, invoice, payment and audit record in it.
  echo    This cannot be undone.
  echo  **********************************************************
  echo.
  set /p "CONFIRM=  Type RESET to confirm, anything else to cancel: "
  if /i not "!CONFIRM!"=="RESET" (
    echo  Cancelled. Nothing was changed.
    exit /b 1
  )
  echo  Removing containers and volumes...
  docker compose --env-file .env -f docker/docker-compose.yml down -v
  set "SEED=1"
)

echo.
echo  Starting PostgreSQL, Redis and MinIO...
REM  --env-file .env is required. Compose looks for a .env beside the COMPOSE
REM  FILE - that is docker/.env, which does not exist - so without this flag the
REM  POSTGRES_PORT / REDIS_PORT / MINIO_PORT overrides the compose file
REM  documents are silently ignored, and the stack fails to start on any machine
REM  where another project already holds one of the default ports.
docker compose --env-file .env -f docker/docker-compose.yml up -d
if errorlevel 1 (
  echo  [X] Could not start the Docker services.
  exit /b 1
)

REM Wait on reported health rather than a fixed sleep: on a cold start
REM PostgreSQL initialises its data directory and takes far longer.
echo  Waiting for services to report healthy...
set "WAITED=0"
:health_loop
set "PG_STATE=starting"
set "REDIS_STATE=starting"
for /f "tokens=*" %%s in ('docker inspect -f "{{.State.Health.Status}}" smartpark-postgres 2^>nul') do set "PG_STATE=%%s"
for /f "tokens=*" %%s in ('docker inspect -f "{{.State.Health.Status}}" smartpark-redis 2^>nul') do set "REDIS_STATE=%%s"

if "!PG_STATE!"=="healthy" if "!REDIS_STATE!"=="healthy" (
  echo  [ok] PostgreSQL and Redis healthy
  exit /b 0
)

set /a WAITED+=2
if !WAITED! GEQ 120 (
  echo  [X] Services did not become healthy within 120 seconds.
  echo      postgres=!PG_STATE!  redis=!REDIS_STATE!
  echo      Inspect with: docker compose --env-file .env -f docker/docker-compose.yml logs
  exit /b 1
)
call :sleep 2
goto health_loop

:detect_empty_database
set "ORG_COUNT="
for /f "tokens=*" %%c in ('docker exec smartpark-postgres psql -U smartpark -d smartpark -tAc "SELECT count(*) FROM organizations" 2^>nul') do set "ORG_COUNT=%%c"
if not defined ORG_COUNT exit /b 0
if "!ORG_COUNT!"=="0" (
  echo  Database is empty - seeding demo data.
  set "SEED=1"
)
exit /b 0

:wait_for_api
REM The API compiles TypeScript on boot, so poll its liveness probe rather
REM than guessing at a duration.
REM
REM curl.exe, not PowerShell. Windows PowerShell 5.1's Invoke-WebRequest
REM cannot finish initialising inside a short -TimeoutSec, so it timed out on
REM EVERY attempt however long the API had been up - the probe could never
REM succeed. curl ships in System32 on Windows 10 1803 and later and answers
REM in about a third of a second.
echo  Waiting for the API to accept requests...
set "APIWAIT=0"
:api_loop
call :probe_api
if not errorlevel 1 (
  echo  [ok] API is live
  exit /b 0
)
set /a APIWAIT+=3
if !APIWAIT! GEQ 180 (
  echo  [warn] The API has not responded after 180 seconds.
  echo      It may still be compiling - check the "YARDOS API" window.
  exit /b 0
)
call :sleep 3
goto api_loop

:probe_api
REM  Exit 0 when the API answers its liveness probe, 1 otherwise.
if defined NO_CURL goto probe_fallback
curl.exe -fsS --max-time 3 http://localhost:3000/health/live >nul 2>&1
exit /b %errorlevel%

:probe_fallback
REM  WebClient rather than Invoke-WebRequest: none of the proxy and parser
REM  start-up cost that makes IWR unusable with a short timeout.
powershell -NoProfile -Command "try { (New-Object System.Net.WebClient).DownloadString('http://localhost:3000/health/live') | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:sleep
REM  Sleep %1 seconds. `ping` rather than `timeout`, which needs a real
REM  console and aborts immediately when stdin is redirected.
set /a "PINGS=%~1+1"
ping -n !PINGS! 127.0.0.1 >nul 2>&1
exit /b 0

:usage
echo.
echo  Usage: start.bat [options]
echo.
echo    --seed        Re-seed the demo data even if the database has rows
echo    --reset       Delete the database and start completely fresh
echo    --no-docker   Do not manage Docker; services are already running
echo    --help        Show this message
echo.
goto end

:fail
echo.
echo  Startup aborted.
echo.
endlocal
exit /b 1

:end
endlocal
exit /b 0
