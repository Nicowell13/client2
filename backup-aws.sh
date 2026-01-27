#!/bin/bash

# ============================================
# Database Backup Script for AWS
# ============================================

set -e

# Configuration
BACKUP_DIR="/var/backups/whatsapp-campaign"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}.sql"
RETENTION_DAYS=7

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Load environment variables
if [ -f .env.aws ]; then
    export $(cat .env.aws | grep -v '^#' | xargs)
fi

# Create backup directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

echo "🗄️  Starting database backup..."

# Backup PostgreSQL database
sudo docker compose -f docker-compose.aws.yml exec -T postgres pg_dump \
    -U ${POSTGRES_USER:-whatsapp_user} \
    ${POSTGRES_DB:-whatsapp_db} \
    > ${BACKUP_DIR}/${BACKUP_FILE}

# Compress backup
echo "📦 Compressing backup..."
gzip ${BACKUP_DIR}/${BACKUP_FILE}

echo -e "${GREEN}✓${NC} Backup created: ${BACKUP_DIR}/${BACKUP_FILE}.gz"

# Delete old backups
echo "🧹 Cleaning up old backups (older than ${RETENTION_DAYS} days)..."
find ${BACKUP_DIR} -name "backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo -e "${GREEN}✅ Backup completed successfully!${NC}"
echo ""
echo "📊 Backup statistics:"
ls -lh ${BACKUP_DIR}/backup_*.sql.gz | tail -5

# Optional: Upload to S3 (uncomment if you want to use S3)
# echo "☁️  Uploading to S3..."
# aws s3 cp ${BACKUP_DIR}/${BACKUP_FILE}.gz s3://your-bucket-name/backups/
# echo -e "${GREEN}✓${NC} Uploaded to S3"
