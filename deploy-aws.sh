#!/bin/bash

# ============================================
# AWS Deployment Script for WhatsApp Campaign Manager
# ============================================

set -e  # Exit on error

echo "Starting AWS deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.aws exists
if [ ! -f .env.aws ]; then
    echo -e "${RED}Error: .env.aws file not found!${NC}"
    echo "Please copy .env.aws.example to .env.aws and fill in your values"
    exit 1
fi

# Load environment variables
export $(cat .env.aws | grep -v '^#' | xargs)

echo -e "${GREEN}Environment variables loaded${NC}"

# Pull latest code (if using git)
if [ -d .git ]; then
    echo "Pulling latest code from git..."
    git pull origin main || git pull origin master
    echo -e "${GREEN}Code updated${NC}"
fi

# Stop existing containers
echo "Stopping existing containers..."
sudo docker compose -f docker-compose.aws.yml down

# Pull latest images
echo "Pulling latest Docker images..."
sudo docker compose -f docker-compose.aws.yml pull

# Build custom images
echo "Building custom images..."
sudo docker compose -f docker-compose.aws.yml build --no-cache

# Start services
echo "Starting services..."
sudo docker compose -f docker-compose.aws.yml up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 10

# Check service health
echo "Checking service health..."
sudo docker compose -f docker-compose.aws.yml ps

# Run database migrations (if needed)
echo "Running database migrations..."
sudo docker compose -f docker-compose.aws.yml exec -T backend npx prisma migrate deploy || echo -e "${YELLOW}Warning: Migration failed or not needed${NC}"

# Show logs
echo ""
echo -e "${GREEN}Deployment completed!${NC}"
echo ""
echo "Service Status:"
sudo docker compose -f docker-compose.aws.yml ps
echo ""
echo "To view logs:"
echo "  sudo docker compose -f docker-compose.aws.yml logs -f"
echo ""
echo "Your application should be accessible at:"
echo "  Frontend: https://app0.watrix.online"
echo "  Backend:  https://api0.watrix.online"
echo ""
echo "Don't forget to configure Nginx Proxy Manager:"
echo "  1. Add proxy host for app0.watrix.online -> http://YOUR_SERVER_IP:8080"
echo "  2. Add proxy host for api0.watrix.online -> http://YOUR_SERVER_IP:8081"
echo "  3. Enable SSL for both domains"
