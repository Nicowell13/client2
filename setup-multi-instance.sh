#!/bin/bash

# Script lengkap untuk setup 10 instances WhatsApp Campaign Manager
# Usage: ./setup-multi-instance.sh

set -e

INSTANCE_BASE_DIR="/opt/whatsapp-instances"
PROJECT_DIR="/opt/whatsapp-campaign"
TEMPLATE_FILE="$PROJECT_DIR/docker-compose.template.yml"

echo "🚀 Setting up 10 instances of WhatsApp Campaign Manager..."
echo ""

# Check if template exists
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "❌ Error: Template file not found: $TEMPLATE_FILE"
    echo "   Please make sure docker-compose.template.yml exists in project directory"
    exit 1
fi

# Create base directory
mkdir -p "$INSTANCE_BASE_DIR"

# Function to generate docker-compose.yml for an instance
generate_instance() {
    local i=$1
    local INSTANCE_DIR="$INSTANCE_BASE_DIR/instance-$i"
    
    # Calculate ports
    local POSTGRES_PORT=$((5431 + i))
    local REDIS_PORT=$((6378 + i))
    local WAHA_PORT=$((2999 + i * 100))
    local BACKEND_PORT=$((3999 + i))
    local FRONTEND_PORT=$((3000 + i))
    
    # Generate unique secrets
    local JWT_SECRET=$(openssl rand -base64 32 | tr -d '\n' | tr -d '/')
    local WAHA_API_KEY=$(openssl rand -hex 16)
    local POSTGRES_PASSWORD=$(openssl rand -base64 16 | tr -d '\n' | tr -d '/')
    
    echo "📦 Generating instance $i..."
    echo "   Directory: $INSTANCE_DIR"
    echo "   PostgreSQL: $POSTGRES_PORT"
    echo "   Redis: $REDIS_PORT"
    echo "   WAHA: $WAHA_PORT"
    echo "   Backend: $BACKEND_PORT"
    echo "   Frontend: $FRONTEND_PORT"
    echo "   Domain: app$i.watrix.online"
    
    # Create instance directory
    mkdir -p "$INSTANCE_DIR"
    
    # Copy project files (excluding node_modules, .git, etc)
    rsync -av --exclude='node_modules' --exclude='.git' --exclude='*.log' \
          --exclude='dist' --exclude='.next' --exclude='instance-*' \
          "$PROJECT_DIR/" "$INSTANCE_DIR/"
    
    # Copy and customize docker-compose.yml
    cp "$TEMPLATE_FILE" "$INSTANCE_DIR/docker-compose.yml"
    
    # Replace variables in docker-compose.yml
    sed -i "s/\${INSTANCE_NUM:-1}/$i/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${POSTGRES_PORT:-5432}/$POSTGRES_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${REDIS_PORT:-6379}/$REDIS_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${WAHA_PORT:-3000}/$WAHA_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${BACKEND_PORT:-4000}/$BACKEND_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${FRONTEND_PORT:-3001}/$FRONTEND_PORT/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s/\${POSTGRES_PASSWORD:-whatsapp_pass}/$POSTGRES_PASSWORD/g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s|\${WAHA_API_KEY}|$WAHA_API_KEY|g" "$INSTANCE_DIR/docker-compose.yml"
    sed -i "s|\${JWT_SECRET}|$JWT_SECRET|g" "$INSTANCE_DIR/docker-compose.yml"
    
    # Create .env file
    cat > "$INSTANCE_DIR/.env" <<EOF
# Instance $i Configuration
# Generated on $(date)

INSTANCE_NUM=$i

# Database Configuration
POSTGRES_USER=whatsapp_user
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=whatsapp_db_$i
POSTGRES_PORT=$POSTGRES_PORT
DATABASE_URL=postgresql://whatsapp_user:$POSTGRES_PASSWORD@postgres-$i:5432/whatsapp_db_$i

# Redis Configuration
REDIS_PORT=$REDIS_PORT
REDIS_URL=redis://redis-$i:6379

# WAHA Configuration
WAHA_PORT=$WAHA_PORT
WAHA_URL=http://waha-$i:3000
WAHA_API_KEY=$WAHA_API_KEY
WAHA_LICENSE_KEY=\${WAHA_LICENSE_KEY:-your-license-key-here}

# Backend API Configuration
BACKEND_PORT=$BACKEND_PORT
BACKEND_URL=https://api$i.watrix.online
JWT_SECRET=$JWT_SECRET
GLOBAL_SEND_CONCURRENCY=2

# Frontend Configuration
FRONTEND_PORT=$FRONTEND_PORT
NEXT_PUBLIC_API_URL=https://api$i.watrix.online

# Node Environment
NODE_ENV=production
PORT=4000
EOF
    
    # Create startup script
    cat > "$INSTANCE_DIR/start.sh" <<'SCRIPT'
#!/bin/bash
cd "$(dirname "$0")"
docker-compose up -d --build

# Wait for database
echo "Waiting for database to be ready..."
sleep 15

# Run migrations
echo "Running database migrations..."
docker exec whatsapp-backend-${INSTANCE_NUM} npx prisma migrate deploy || true
docker exec whatsapp-backend-${INSTANCE_NUM} npx prisma generate || true

echo "Instance ${INSTANCE_NUM} started!"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "Backend: http://localhost:${BACKEND_PORT}"
SCRIPT
    chmod +x "$INSTANCE_DIR/start.sh"
    
    # Create stop script
    cat > "$INSTANCE_DIR/stop.sh" <<'SCRIPT'
#!/bin/bash
cd "$(dirname "$0")"
docker-compose down
echo "Instance ${INSTANCE_NUM} stopped!"
SCRIPT
    chmod +x "$INSTANCE_DIR/stop.sh"
    
    # Create restart script
    cat > "$INSTANCE_DIR/restart.sh" <<'SCRIPT'
#!/bin/bash
cd "$(dirname "$0")"
docker-compose restart
echo "Instance ${INSTANCE_NUM} restarted!"
SCRIPT
    chmod +x "$INSTANCE_DIR/restart.sh"
    
    echo "✅ Instance $i generated successfully!"
    echo ""
}

# Generate all instances
for i in {1..10}; do
    generate_instance $i
done

# Create master management script
cat > "$INSTANCE_BASE_DIR/manage-all.sh" <<'MASTER'
#!/bin/bash

ACTION=$1
INSTANCE_NUM=$2

if [ -z "$ACTION" ]; then
    echo "Usage: $0 <start|stop|restart|status> [instance_number]"
    echo ""
    echo "Examples:"
    echo "  $0 start          # Start all instances"
    echo "  $0 stop           # Stop all instances"
    echo "  $0 restart        # Restart all instances"
    echo "  $0 status         # Show status of all instances"
    echo "  $0 start 1         # Start instance 1 only"
    echo "  $0 stop 5         # Stop instance 5 only"
    exit 1
fi

if [ -n "$INSTANCE_NUM" ]; then
    # Single instance
    INSTANCE_DIR="/opt/whatsapp-instances/instance-$INSTANCE_NUM"
    if [ ! -d "$INSTANCE_DIR" ]; then
        echo "❌ Instance $INSTANCE_NUM not found!"
        exit 1
    fi
    
    cd "$INSTANCE_DIR"
    case $ACTION in
        start)
            ./start.sh
            ;;
        stop)
            ./stop.sh
            ;;
        restart)
            ./restart.sh
            ;;
        status)
            docker-compose ps
            ;;
        *)
            echo "Unknown action: $ACTION"
            exit 1
            ;;
    esac
else
    # All instances
    for i in {1..10}; do
        INSTANCE_DIR="/opt/whatsapp-instances/instance-$i"
        if [ -d "$INSTANCE_DIR" ]; then
            echo "Processing instance $i..."
            cd "$INSTANCE_DIR"
            case $ACTION in
                start)
                    ./start.sh
                    ;;
                stop)
                    ./stop.sh
                    ;;
                restart)
                    ./restart.sh
                    ;;
                status)
                    echo "=== Instance $i ==="
                    docker-compose ps
                    echo ""
                    ;;
            esac
        fi
    done
fi
MASTER
chmod +x "$INSTANCE_BASE_DIR/manage-all.sh"

# Print summary
echo "🎉 All 10 instances generated successfully!"
echo ""
echo "📋 Port Summary:"
echo "┌──────────┬─────────────┬────────┬───────┬─────────┬──────────┬────────────────────┐"
echo "│ Instance │ PostgreSQL  │ Redis  │ WAHA  │ Backend │ Frontend │ Domain             │"
echo "├──────────┼─────────────┼────────┼───────┼─────────┼──────────┼────────────────────┤"
for i in {1..10}; do
    POSTGRES_PORT=$((5431 + i))
    REDIS_PORT=$((6378 + i))
    WAHA_PORT=$((2999 + i * 100))
    BACKEND_PORT=$((3999 + i))
    FRONTEND_PORT=$((3000 + i))
    printf "│    %2d    │    %5d    │  %4d  │ %5d │  %5d  │   %5d  │ app%d.watrix.online │\n" \
           $i $POSTGRES_PORT $REDIS_PORT $WAHA_PORT $BACKEND_PORT $FRONTEND_PORT $i
done
echo "└──────────┴─────────────┴────────┴───────┴─────────┴──────────┴────────────────────┘"
echo ""
echo "📁 Instances directory: $INSTANCE_BASE_DIR"
echo ""
echo "🚀 Next steps:"
echo "   1. Review .env files in each instance directory"
echo "   2. Update WAHA_LICENSE_KEY in each .env file"
echo "   3. Start instances: cd $INSTANCE_BASE_DIR && ./manage-all.sh start"
echo "   4. Or start individual: cd $INSTANCE_BASE_DIR/instance-1 && ./start.sh"
echo ""
echo "📝 Management commands:"
echo "   Start all:    $INSTANCE_BASE_DIR/manage-all.sh start"
echo "   Stop all:     $INSTANCE_BASE_DIR/manage-all.sh stop"
echo "   Restart all:  $INSTANCE_BASE_DIR/manage-all.sh restart"
echo "   Status all:   $INSTANCE_BASE_DIR/manage-all.sh status"
echo "   Start one:    $INSTANCE_BASE_DIR/manage-all.sh start 1"
echo ""
