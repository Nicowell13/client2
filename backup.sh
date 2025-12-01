#!/bin/bash

# Daily backup script for WhatsApp Campaign Manager

BACKUP_DIR="/opt/backups/whatsapp-campaign"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

# Create backup directory
mkdir -p $BACKUP_DIR

echo "Starting backup at $(date)"

# Backup PostgreSQL database
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup WAHA sessions
tar -czf $BACKUP_DIR/waha_sessions_$DATE.tar.gz -C /var/lib/docker/volumes whatsapp-campaign_waha_data/_data 2>/dev/null || true

# Backup environment file
cp .env $BACKUP_DIR/env_$DATE.bak

# Remove old backups (older than retention days)
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "waha_sessions_*.tar.gz" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "env_*.bak" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR"
echo "Database: db_$DATE.sql.gz"
echo "Sessions: waha_sessions_$DATE.tar.gz"
