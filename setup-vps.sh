#!/bin/bash

echo "========================================"
echo "WhatsApp Campaign Manager - VPS Setup"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}[ERROR]${NC} Please run as root (use sudo)"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[INFO]${NC} Docker not found. Installing Docker..."
    
    # Update packages
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release
    
    # Add Docker's official GPG key
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Start Docker
    systemctl start docker
    systemctl enable docker
    
    echo -e "${GREEN}✓${NC} Docker installed successfully"
else
    echo -e "${GREEN}✓${NC} Docker already installed"
fi

# Check if Docker Compose is installed
if ! command -v docker compose &> /dev/null; then
    echo -e "${YELLOW}[INFO]${NC} Installing Docker Compose..."
    apt-get install -y docker-compose-plugin
    echo -e "${GREEN}✓${NC} Docker Compose installed"
else
    echo -e "${GREEN}✓${NC} Docker Compose already installed"
fi

echo ""
echo "[1/8] Stopping existing containers..."
docker compose down 2>/dev/null || true

echo ""
echo "[2/8] Cleaning up old images and containers..."
docker system prune -f

echo ""
echo "[3/8] Building and starting services..."
docker compose up -d --build

echo ""
echo "[4/8] Waiting for PostgreSQL to be ready (20 seconds)..."
sleep 20

echo ""
echo "[5/8] Generating Prisma Client..."
docker exec whatsapp-backend npx prisma generate

echo ""
echo "[6/8] Running database migrations..."
docker exec whatsapp-backend npx prisma migrate deploy

echo ""
echo "[7/8] Creating admin user..."
docker exec whatsapp-backend node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

(async () => {
  try {
    const hash = await bcrypt.hash('admin123', 10);
    const user = await prisma.user.create({
      data: {
        email: 'admin@example.com',
        password: hash,
        name: 'Admin User',
        role: 'admin'
      }
    });
    console.log('✓ Admin user created:', user.email);
  } catch (e) {
    if (e.code === 'P2002') {
      console.log('✓ Admin user already exists');
    } else {
      console.error('Error:', e.message);
    }
  } finally {
    await prisma.\$disconnect();
  }
})();
"

echo ""
echo "[8/8] Setting up firewall rules..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    ufw allow 3001/tcp  # Frontend
    ufw allow 4000/tcp  # Backend
    ufw --force enable
    echo -e "${GREEN}✓${NC} Firewall configured"
else
    echo -e "${YELLOW}⚠${NC} UFW not found, skipping firewall setup"
fi

echo ""
echo "========================================"
echo -e "${GREEN}Setup completed successfully!${NC}"
echo "========================================"
echo ""
echo "Services are running:"
echo "----------------------------------------"
echo "Frontend:  http://$(hostname -I | awk '{print $1}'):3001"
echo "Backend:   http://$(hostname -I | awk '{print $1}'):4000"
echo "WAHA:      http://$(hostname -I | awk '{print $1}'):3000"
echo "----------------------------------------"
echo ""
echo "Login credentials:"
echo "Email:    admin@example.com"
echo "Password: admin123"
echo "----------------------------------------"
echo ""
echo "Useful commands:"
echo "  View logs:     docker compose logs -f"
echo "  Stop all:      docker compose down"
echo "  Restart:       docker compose restart"
echo "  Update:        git pull && ./setup-vps.sh"
echo "========================================"
echo ""
echo -e "${YELLOW}IMPORTANT:${NC}"
echo "1. Change default passwords in .env file"
echo "2. Configure domain/SSL for production"
echo "3. Setup regular backups"
echo ""
