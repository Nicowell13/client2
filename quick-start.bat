@echo off
echo ========================================
echo WhatsApp Campaign Manager - Quick Setup
echo ========================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker tidak terinstall!
    echo.
    echo Silakan install Docker Desktop dari:
    echo https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

echo [1/6] Stopping existing containers...
docker-compose down 2>nul

echo.
echo [2/6] Building and starting services...
docker-compose up -d --build

echo.
echo [3/6] Waiting for PostgreSQL to be ready (15 seconds)...
timeout /t 15 /nobreak >nul

echo.
echo [4/6] Running database migrations...
docker exec whatsapp-backend npx prisma generate
docker exec whatsapp-backend npx prisma migrate deploy

echo.
echo [5/6] Creating admin user...
docker exec whatsapp-backend node -e "const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcryptjs'); const prisma = new PrismaClient(); (async () => { try { const hash = await bcrypt.hash('admin123', 10); const user = await prisma.user.create({ data: { email: 'admin@example.com', password: hash, name: 'Admin User', role: 'admin' } }); console.log('✓ Admin user created:', user.email); } catch (e) { if (e.code === 'P2002') { console.log('✓ Admin user already exists'); } else { console.error('Error:', e.message); } } finally { await prisma.$disconnect(); } })();"

echo.
echo [6/6] Setup completed!
echo.
echo ========================================
echo Services are running:
echo ========================================
echo Frontend:  http://localhost:3001
echo Backend:   http://localhost:4000
echo WAHA:      http://localhost:3000
echo ========================================
echo.
echo Login credentials:
echo Email:    admin@example.com
echo Password: admin123
echo ========================================
echo.
echo To view logs: docker-compose logs -f
echo To stop:      docker-compose down
echo ========================================
pause
