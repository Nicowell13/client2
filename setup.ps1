#!/usr/bin/env powershell

Write-Host "🚀 Starting WhatsApp Campaign Manager Setup..." -ForegroundColor Green

# Check if Docker is running
try {
    docker info | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Copy environment file if not exists
if (-not (Test-Path .env)) {
    Write-Host "📝 Creating .env file from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "✅ .env file created" -ForegroundColor Green
} else {
    Write-Host "✅ .env file already exists" -ForegroundColor Green
}

# Build and start containers
Write-Host "🔨 Building and starting Docker containers..." -ForegroundColor Yellow
docker-compose up -d --build

# Wait for PostgreSQL to be ready
Write-Host "⏳ Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# Run database migrations
Write-Host "🗄️  Running database migrations..." -ForegroundColor Yellow
docker exec whatsapp-backend npx prisma migrate deploy
docker exec whatsapp-backend npx prisma generate

Write-Host ""
Write-Host "✅ Setup completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📱 Application URLs:" -ForegroundColor Cyan
Write-Host "   Frontend:  http://localhost:3001" -ForegroundColor White
Write-Host "   Backend:   http://localhost:4000" -ForegroundColor White
Write-Host "   WAHA:      http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "🔧 Useful commands:" -ForegroundColor Cyan
Write-Host "   View logs:        docker-compose logs -f" -ForegroundColor White
Write-Host "   Stop services:    docker-compose down" -ForegroundColor White
Write-Host "   Restart services: docker-compose restart" -ForegroundColor White
Write-Host ""
Write-Host "📖 For more information, read PANDUAN.md" -ForegroundColor Cyan
Write-Host ""
