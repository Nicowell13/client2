# 🚀 Panduan Setup Multi-Instance (10 Instances)

## Overview

Script ini akan membuat 10 instance terpisah dengan konfigurasi lengkap:
- Setiap instance memiliki database PostgreSQL sendiri
- Setiap instance memiliki WAHA Plus sendiri
- Setiap instance memiliki backend API sendiri
- Setiap instance memiliki frontend sendiri
- Setiap instance memiliki Redis queue sendiri

## Port Mapping

| Instance | PostgreSQL | Redis | WAHA  | Backend | Frontend | Domain             |
|----------|------------|-------|-------|---------|----------|-------------------|
| 1        | 5432       | 6379  | 3000  | 4000    | 3001     | app1.watrix.online|
| 2        | 5433       | 6380  | 3100  | 4001    | 3002     | app2.watrix.online|
| 3        | 5434       | 6381  | 3200  | 4002    | 3003     | app3.watrix.online|
| 4        | 5435       | 6382  | 3300  | 4003    | 3004     | app4.watrix.online|
| 5        | 5436       | 6383  | 3400  | 4004    | 3005     | app5.watrix.online|
| 6        | 5437       | 6384  | 3500  | 4005    | 3006     | app6.watrix.online|
| 7        | 5438       | 6385  | 3600  | 4006    | 3007     | app7.watrix.online|
| 8        | 5439       | 6386  | 3700  | 4007    | 3008     | app8.watrix.online|
| 9        | 5440       | 6387  | 3800  | 4008    | 3009     | app9.watrix.online|
| 10       | 5441       | 6388  | 3900  | 4009    | 3010     | app10.watrix.online|

## Setup Instructions

### 1. Persiapan

```bash
# Pastikan project sudah ada di /opt/whatsapp-campaign
cd /opt/whatsapp-campaign

# Pastikan docker-compose.template.yml ada
ls -la docker-compose.template.yml
```

### 2. Generate All Instances

```bash
# Buat script executable
chmod +x setup-multi-instance.sh

# Jalankan script
./setup-multi-instance.sh
```

Script akan:
- Membuat 10 direktori instance di `/opt/whatsapp-instances/`
- Generate docker-compose.yml untuk setiap instance
- Generate .env file dengan konfigurasi unik
- Generate startup/stop/restart scripts
- Generate management script untuk semua instances

### 3. Update WAHA License Key

Setelah generate, update WAHA_LICENSE_KEY di setiap .env file:

```bash
# Edit .env untuk setiap instance
for i in {1..10}; do
    nano /opt/whatsapp-instances/instance-$i/.env
    # Update WAHA_LICENSE_KEY dengan license key Anda
done
```

Atau gunakan sed:

```bash
WAHA_LICENSE="your-actual-license-key-here"
for i in {1..10}; do
    sed -i "s/WAHA_LICENSE_KEY=.*/WAHA_LICENSE_KEY=$WAHA_LICENSE/" \
        /opt/whatsapp-instances/instance-$i/.env
done
```

### 4. Start Instances

#### Start All Instances

```bash
cd /opt/whatsapp-instances
./manage-all.sh start
```

#### Start Single Instance

```bash
cd /opt/whatsapp-instances/instance-1
./start.sh
```

Atau:

```bash
cd /opt/whatsapp-instances
./manage-all.sh start 1
```

### 5. Verify Installation

```bash
# Check status semua instances
cd /opt/whatsapp-instances
./manage-all.sh status

# Check logs instance tertentu
cd /opt/whatsapp-instances/instance-1
docker-compose logs -f

# Test backend API
curl http://localhost:4000/health
curl http://localhost:4001/health

# Test frontend
curl http://localhost:3001
curl http://localhost:3002
```

## Management Commands

### Start/Stop/Restart All

```bash
cd /opt/whatsapp-instances

# Start semua instances
./manage-all.sh start

# Stop semua instances
./manage-all.sh stop

# Restart semua instances
./manage-all.sh restart

# Status semua instances
./manage-all.sh status
```

### Start/Stop/Restart Single Instance

```bash
cd /opt/whatsapp-instances

# Start instance 1
./manage-all.sh start 1

# Stop instance 5
./manage-all.sh stop 5

# Restart instance 3
./manage-all.sh restart 3

# Status instance 2
./manage-all.sh status 2
```

### Manual Management per Instance

```bash
# Masuk ke direktori instance
cd /opt/whatsapp-instances/instance-1

# Start
./start.sh
# atau
docker-compose up -d

# Stop
./stop.sh
# atau
docker-compose down

# Restart
./restart.sh
# atau
docker-compose restart

# View logs
docker-compose logs -f

# View status
docker-compose ps
```

## Nginx Configuration

Setelah semua instances running, setup Nginx untuk routing berdasarkan domain:

```bash
nano /etc/nginx/sites-available/watrix-multi
```

```nginx
# Instance 1 - Frontend
server {
    listen 80;
    server_name app1.watrix.online;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}

# Instance 1 - Backend API
server {
    listen 80;
    server_name api1.watrix.online;
    
    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Instance 2 - Frontend
server {
    listen 80;
    server_name app2.watrix.online;
    location / { proxy_pass http://localhost:3002; }
}

# Instance 2 - Backend API
server {
    listen 80;
    server_name api2.watrix.online;
    location / { proxy_pass http://localhost:4001; }
}

# ... duplikat untuk instance 3-10
```

Enable dan reload Nginx:

```bash
ln -s /etc/nginx/sites-available/watrix-multi /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## DNS Configuration

Setup DNS records di Cloudflare atau DNS provider Anda:

```
Type: A Record
Name: app1.watrix.online
Value: YOUR_VPS_IP
TTL: Auto

Type: A Record
Name: api1.watrix.online
Value: YOUR_VPS_IP
TTL: Auto

... (duplikat untuk app2-api2 hingga app10-api10)
```

## Backup

### Backup Single Instance

```bash
INSTANCE_NUM=1
BACKUP_DIR="/opt/backups/instance-$INSTANCE_NUM"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup Database
docker exec whatsapp-postgres-$INSTANCE_NUM pg_dump -U whatsapp_user whatsapp_db_$INSTANCE_NUM > $BACKUP_DIR/db_$DATE.sql

# Backup WAHA sessions
docker cp whatsapp-waha-$INSTANCE_NUM:/app/.sessions $BACKUP_DIR/sessions_$DATE

# Compress
gzip $BACKUP_DIR/db_$DATE.sql
tar -czf $BACKUP_DIR/sessions_$DATE.tar.gz $BACKUP_DIR/sessions_$DATE
```

### Backup All Instances

```bash
for i in {1..10}; do
    echo "Backing up instance $i..."
    INSTANCE_NUM=$i
    BACKUP_DIR="/opt/backups/instance-$INSTANCE_NUM"
    DATE=$(date +%Y%m%d_%H%M%S)
    mkdir -p $BACKUP_DIR
    
    docker exec whatsapp-postgres-$INSTANCE_NUM pg_dump -U whatsapp_user whatsapp_db_$INSTANCE_NUM > $BACKUP_DIR/db_$DATE.sql
    docker cp whatsapp-waha-$INSTANCE_NUM:/app/.sessions $BACKUP_DIR/sessions_$DATE
    
    gzip $BACKUP_DIR/db_$DATE.sql
    tar -czf $BACKUP_DIR/sessions_$DATE.tar.gz $BACKUP_DIR/sessions_$DATE
done
```

## Monitoring

### Check Resource Usage

```bash
# Docker stats untuk semua containers
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Filter per instance
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep "whatsapp-backend-"
```

### Check Logs

```bash
# Logs instance tertentu
cd /opt/whatsapp-instances/instance-1
docker-compose logs -f backend

# Logs semua backend
for i in {1..10}; do
    echo "=== Instance $i Backend Logs ==="
    docker logs whatsapp-backend-$i --tail 50
done
```

## Troubleshooting

### Instance Tidak Start

```bash
# Check logs
cd /opt/whatsapp-instances/instance-1
docker-compose logs

# Check port conflicts
netstat -tlnp | grep :3001
netstat -tlnp | grep :4001

# Restart instance
docker-compose restart
```

### Database Connection Error

```bash
# Check database container
docker ps | grep whatsapp-postgres-1

# Check database logs
docker logs whatsapp-postgres-1

# Restart database
docker restart whatsapp-postgres-1

# Run migration lagi
docker exec whatsapp-backend-1 npx prisma migrate deploy
```

### WAHA QR Tidak Muncul

```bash
# Check WAHA logs
docker logs whatsapp-waha-1

# Restart WAHA
docker restart whatsapp-waha-1

# Check WAHA API
curl http://localhost:3000/api/sessions
```

## Resource Requirements

Untuk 10 instances, rekomendasi VPS:
- **CPU:** 8-16 cores
- **RAM:** 16-32GB
- **Storage:** 100-150GB SSD
- **Bandwidth:** 1TB/month

Per instance menggunakan:
- RAM: ~1.5-2.5GB
- CPU: ~0.5-1 core (idle), ~1-2 cores (active)
- Storage: ~5-10GB

---

**Selamat Setup Multi-Instance! 🚀**
