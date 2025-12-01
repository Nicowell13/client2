#!/bin/bash

echo "🚀 Starting WhatsApp Campaign Manager Setup..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Copy environment file if not exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your configurations."
else
    echo "✅ .env file already exists"
fi

# Build and start containers
echo "🔨 Building and starting Docker containers..."
docker-compose up -d --build

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 10

# Run database migrations
echo "🗄️  Running database migrations..."
docker exec -it whatsapp-backend npx prisma migrate deploy
docker exec -it whatsapp-backend npx prisma generate

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "📱 Application URLs:"
echo "   Frontend:  http://localhost:3001"
echo "   Backend:   http://localhost:4000"
echo "   WAHA:      http://localhost:3000"
echo ""
echo "🔧 Useful commands:"
echo "   View logs:        docker-compose logs -f"
echo "   Stop services:    docker-compose down"
echo "   Restart services: docker-compose restart"
echo ""
echo "📖 For more information, read SETUP.md"
