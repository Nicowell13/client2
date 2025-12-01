@echo off
echo Starting WhatsApp Campaign Manager Setup...

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Copy environment file if not exists
if not exist .env (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo .env file created. Please edit it with your configurations.
) else (
    echo .env file already exists
)

REM Build and start containers
echo Building and starting Docker containers...
docker-compose up -d --build

REM Wait for PostgreSQL to be ready
echo Waiting for PostgreSQL to be ready...
timeout /t 15 /nobreak >nul

REM Run database migrations
echo Running database migrations...
docker exec -it whatsapp-backend npx prisma migrate deploy
docker exec -it whatsapp-backend npx prisma generate

echo.
echo Setup completed successfully!
echo.
echo Application URLs:
echo    Frontend:  http://localhost:3001
echo    Backend:   http://localhost:4000
echo    WAHA:      http://localhost:3000
echo.
echo Useful commands:
echo    View logs:        docker-compose logs -f
echo    Stop services:    docker-compose down
echo    Restart services: docker-compose restart
echo.
echo For more information, read SETUP.md
echo.
pause
