#!/bin/bash

# Script untuk generate docker-compose.yml untuk 10 instances
# Usage: ./generate-instances.sh

INSTANCE_BASE_DIR="/opt/whatsapp-instances"
TEMPLATE_FILE="docker-compose.template.yml"

# Port mapping untuk setiap instance
# Instance 1: PostgreSQL=5432, Redis=6379, WAHA=3000, Backend=4000, Frontend=3001
# Instance 2: PostgreSQL=5433, Redis=6380, WAHA=3100, Backend=4001, Frontend=3002
# dst...

echo "🚀 Generating docker-compose.yml for 10 instances..."

for i in {1..10}; do
    INSTANCE_DIR="$INSTANCE_BASE_DIR/instance-$i"
    mkdir -p "$INSTANCE_DIR"
    
    # Calculate ports
    POSTGRES_PORT=$((5431 + i))
    REDIS_PORT=$((6378 + i))
    WAHA_PORT=$((2999 + i * 100))
    BACKEND_PORT=$((3999 + i))
    FRONTEND_PORT=$((3000 + i))
    
    # Generate unique secrets
    JWT_SECRET=$(openssl rand -base64 32 | tr -d '\n')
    WAHA_API_KEY=$(openssl rand -hex 16)
    POSTGRES_PASSWORD=$(openssl rand -base64 16 | tr -d '\n')
    
    echo "📦 Generating instance $i..."
    echo "   PostgreSQL: $POSTGRES_PORT"
    echo "   Redis: $REDIS_PORT"
    echo "   WAHA: $WAHA_PORT"
    echo "   Backend: $BACKEND_PORT"
    echo "   Frontend: $FRONTEND_PORT"
    
    # Copy template
    cp "$TEMPLATE_FILE" "$INSTANCE_DIR/docker-compose.yml"
    
    # Replace variables
    sed -i "s/\${INSTANCE_NUM:-1}/$i/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${POSTGRES_PORT:-5432}/$POSTGRES_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${REDIS_PORT:-6379}/$REDIS_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${WAHA_PORT:-3000}/$WAHA_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${BACKEND_PORT:-4000}/$BACKEND_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${FRONTEND_PORT:-3001}/$FRONTEND_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${POSTGRES_PASSWORD:-whatsapp_pass}/$POSTGRES_PASSWORD/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${WAHA_API_KEY}/$WAHA_API_KEY/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${JWT_SECRET}/$JWT_SECRET/g" "$INSTANCE_DIR/docker-compose.yml"
    
    # Create .env file
    cat > "$INSTANCE_DIR/.env" <<EOF
# Instance $i Configuration
INSTANCE_NUM=$i

# Database
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_PORT=$POSTGRES_PORT
DATABASE_URL=postgresql://whatsapp_user:$POSTGRES_PASSWORD@postgres-$i:5432/whatsapp_db_$i

# Redis
REDIS_PORT=$REDIS_PORT
REDIS_URL=redis://redis-$i:6379

# WAHA
WAHA_PORT=$WAHA_PORT
WAHA_URL=http://waha-$i:3000
WAHA_API_KEY=$WAHA_API_KEY
WAHA_LICENSE_KEY=\${WAHA_LICENSE_KEY:-your-license-key-here}

# Backend API
BACKEND_PORT=$BACKEND_PORT
BACKEND_URL=https://api$i.watrix.online
JWT_SECRET=$JWT_SECRET

# Frontend
FRONTEND_PORT=$FRONTEND_PORT
NEXT_PUBLIC_API_URL=https://api$i.watrix.online

# Node Environment
NODE_ENV=production
EOF
    
    echo "✅ Instance $i generated successfully!"
    echo ""
done

echo "🎉 All 10 instances generated successfully!"
echo ""
echo "📋 Port Summary:"
echo "Instance | PostgreSQL | Redis | WAHA  | Backend | Frontend | Domain"
echo "---------|------------|-------|-------|---------|----------|----------------"
for i in {1..10}; do
    POSTGRES_PORT=$((5431 + i))
    REDIS_PORT=$((6378 + i))
    WAHA_PORT=$((2999 + i * 100))
    BACKEND_PORT=$((3999 + i))
    FRONTEND_PORT=$((3000 + i))
    echo "   $i     |   $POSTGRES_PORT   | $REDIS_PORT | $WAHA_PORT |  $BACKEND_PORT  |   $FRONTEND_PORT   | app$i.watrix.online"
done
