# 📚 Panduan Multi-Instance Setup

## Konsep Dasar: Isolasi Penuh Per Instance

Setiap instance adalah **aplikasi lengkap dan terisolasi** dengan stack sendiri:

```
Instance 1:
├── PostgreSQL Database (port 5432)
├── Redis Queue (port 6379)
├── WAHA Plus (port 3000)
├── Backend API (port 4000)
└── Frontend (port 3001)

Instance 2:
├── PostgreSQL Database (port 5433) ← TERPISAH
├── Redis Queue (port 6380) ← TERPISAH
├── WAHA Plus (port 3100) ← TERPISAH
├── Backend API (port 4001) ← TERPISAH
└── Frontend (port 3002) ← TERPISAH

... dst untuk instance 3-10
```

## Mengapa Isolasi Penuh?

### ✅ Keuntungan

1. **Keamanan Data**
   - Data tidak saling bercampur antar instance
   - Jika 1 instance di-hack, yang lain tetap aman
   - Compliance lebih mudah (data terpisah)

2. **Stabilitas**
   - Jika 1 instance crash, yang lain tetap berjalan
   - Tidak ada single point of failure antar instance
   - Bisa restart instance secara independen

3. **Skalabilitas**
   - Bisa scale instance tertentu tanpa mempengaruhi yang lain
   - Resource allocation lebih jelas
   - Monitoring per instance lebih mudah

4. **Maintenance**
   - Update bisa dilakukan per instance
   - Backup/restore per instance lebih mudah
   - Testing di 1 instance tidak mempengaruhi production di instance lain

5. **Multi-Tenant**
   - Setiap instance bisa untuk client berbeda
   - Billing per instance lebih mudah
   - Customization per instance lebih fleksibel

### ⚠️ Trade-off

1. **Resource Usage**
   - Setiap instance menggunakan RAM/CPU sendiri
   - Tidak ada resource sharing (lebih banyak overhead)
   - Perlu VPS yang lebih besar untuk banyak instance

2. **Management**
   - Perlu manage banyak database
   - Perlu manage banyak WAHA session
   - Backup lebih kompleks (per instance)

## Resource Requirements

### Per Instance (Idle)
- **RAM:** ~1.5-2GB
  - PostgreSQL: 200-400MB
  - Redis: 50-100MB
  - WAHA: 300-500MB
  - Backend: 150-300MB
  - Frontend: 200-400MB
  - Nginx: 20-50MB
  - Overhead: 500MB

- **CPU:** ~0.1-0.3 cores
- **Storage:** ~3-5GB (database + files)

### Per Instance (Active - Campaign Running)
- **RAM:** ~2-3GB (peak bisa sampai 3.5GB)
- **CPU:** ~0.5-1.5 cores
- **Storage:** ~5-10GB (dengan media files)

### Estimasi VPS untuk N Instances

| Instances | RAM Minimum | RAM Optimal | CPU Minimum | CPU Optimal | Storage |
|-----------|-------------|-------------|-------------|-------------|---------|
| 1 | 4GB | 4GB | 2 cores | 2 cores | 20GB |
| 2-3 | 8GB | 8GB | 4 cores | 4 cores | 50GB |
| 4-5 | 12GB | 16GB | 6 cores | 8 cores | 80GB |
| 6-8 | 16GB | 24GB | 8 cores | 12 cores | 120GB |
| 9-10 | 20GB | 32GB | 10 cores | 16 cores | 150GB |

**Rekomendasi untuk 4 cores/8GB RAM:**
- ✅ **Optimal:** 2-3 instances
- ⚠️ **Maksimal:** 3-4 instances (dengan optimasi)
- ❌ **Tidak disarankan:** >4 instances

## Setup Multi-Instance

### Step 1: Persiapan

```bash
# Buat direktori untuk semua instances
mkdir -p /opt/whatsapp-instances
cd /opt/whatsapp-instances

# Clone atau copy project template
cp -r /opt/whatsapp-campaign /opt/whatsapp-instances/template
```

### Step 2: Script Otomatis Setup Instance

Buat script `setup-instance.sh`:

```bash
#!/bin/bash

INSTANCE_NUM=$1
if [ -z "$INSTANCE_NUM" ]; then
    echo "Usage: ./setup-instance.sh <instance_number>"
    exit 1
fi

INSTANCE_DIR="/opt/whatsapp-instances/instance-$INSTANCE_NUM"
TEMPLATE_DIR="/opt/whatsapp-instances/template"

# Copy template
cp -r $TEMPLATE_DIR $INSTANCE_DIR
cd $INSTANCE_DIR

# Update ports
FRONTEND_PORT=$((3000 + INSTANCE_NUM))
BACKEND_PORT=$((4000 + INSTANCE_NUM))
WAHA_PORT=$((3100 + INSTANCE_NUM))
POSTGRES_PORT=$((5432 + INSTANCE_NUM))
REDIS_PORT=$((6379 + INSTANCE_NUM))

# Update docker-compose.yml ports
sed -i "s/3001:3001/${FRONTEND_PORT}:3001/" docker-compose.yml
sed -i "s/4000:4000/${BACKEND_PORT}:4000/" docker-compose.yml
sed -i "s/3000:3000/${WAHA_PORT}:3000/" docker-compose.yml
sed -i "s/5432:5432/${POSTGRES_PORT}:5432/" docker-compose.yml
sed -i "s/6379:6379/${REDIS_PORT}:6379/" docker-compose.yml

# Update container names
sed -i "s/whatsapp-postgres/whatsapp-postgres-$INSTANCE_NUM/" docker-compose.yml
sed -i "s/whatsapp-redis/whatsapp-redis-$INSTANCE_NUM/" docker-compose.yml
sed -i "s/whatsapp-waha/whatsapp-waha-$INSTANCE_NUM/" docker-compose.yml
sed -i "s/whatsapp-backend/whatsapp-backend-$INSTANCE_NUM/" docker-compose.yml
sed -i "s/whatsapp-frontend/whatsapp-frontend-$INSTANCE_NUM/" docker-compose.yml
sed -i "s/whatsapp-nginx/whatsapp-nginx-$INSTANCE_NUM/" docker-compose.yml

# Update network names
sed -i "s/whatsapp-network/whatsapp-network-$INSTANCE_NUM/" docker-compose.yml

# Update volume names
sed -i "s/postgres_data/postgres_data_$INSTANCE_NUM/" docker-compose.yml
sed -i "s/redis_data/redis_data_$INSTANCE_NUM/" docker-compose.yml
sed -i "s/waha_data/waha_data_$INSTANCE_NUM/" docker-compose.yml
sed -i "s/waha_files/waha_files_$INSTANCE_NUM/" docker-compose.yml

# Update .env untuk database terpisah
DB_NAME="whatsapp_db_$INSTANCE_NUM"
sed -i "s/whatsapp_db/$DB_NAME/" .env
sed -i "s|postgres:5432|postgres-$INSTANCE_NUM:5432|" .env
sed -i "s|redis:6379|redis-$INSTANCE_NUM:6379|" .env
sed -i "s|waha:3000|waha-$INSTANCE_NUM:3000|" .env

# Update backend URL
sed -i "s|BACKEND_URL=.*|BACKEND_URL=http://api$INSTANCE_NUM.yourdomain.com|" .env
sed -i "s|NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=http://api$INSTANCE_NUM.yourdomain.com|" .env

# Generate unique JWT secret
JWT_SECRET=$(openssl rand -base64 32)
sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env

# Generate unique WAHA API key
WAHA_API_KEY=$(openssl rand -hex 16)
sed -i "s|WAHA_API_KEY=.*|WAHA_API_KEY=$WAHA_API_KEY|" .env

echo "Instance $INSTANCE_NUM configured!"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "Backend: http://localhost:$BACKEND_PORT"
echo "WAHA: http://localhost:$WAHA_PORT"
```

### Step 3: Deploy Instance

```bash
# Buat script executable
chmod +x setup-instance.sh

# Setup instance 1
./setup-instance.sh 1

# Setup instance 2
./setup-instance.sh 2

# ... dst untuk instance 3-10
```

### Step 4: Start Instance

```bash
cd /opt/whatsapp-instances/instance-1
docker-compose up -d

# Wait untuk database ready
sleep 15

# Run migration untuk database instance ini
docker exec whatsapp-backend-1 npx prisma migrate deploy
docker exec whatsapp-backend-1 npx prisma generate

echo "Instance 1 deployed!"
```

### Step 5: Setup Nginx untuk Multi-Instance

```bash
nano /etc/nginx/sites-available/multi-instance
```

```nginx
# Instance 1 - Frontend
server {
    listen 80;
    server_name wa1.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Instance 1 - Backend API
server {
    listen 80;
    server_name api1.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:4001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Instance 2 - Frontend
server {
    listen 80;
    server_name wa2.yourdomain.com;
    location / { proxy_pass http://localhost:3002; }
}

# Instance 2 - Backend API
server {
    listen 80;
    server_name api2.yourdomain.com;
    location / { proxy_pass http://localhost:4002; }
}

# ... duplikat untuk instance 3-10
```

## Monitoring Multi-Instance

### Check Status Semua Instance

```bash
#!/bin/bash
# check-all-instances.sh

for i in {1..10}; do
    echo "=== Instance $i ==="
    cd /opt/whatsapp-instances/instance-$i
    docker-compose ps
    echo ""
done
```

### Check Resource Usage

```bash
# Docker stats untuk semua container
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

## Backup Multi-Instance

### Backup Script Per Instance

```bash
#!/bin/bash
# backup-instance.sh

INSTANCE_NUM=$1
if [ -z "$INSTANCE_NUM" ]; then
    echo "Usage: ./backup-instance.sh <instance_number>"
    exit 1
fi

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/backups/instance-$INSTANCE_NUM"
mkdir -p $BACKUP_DIR

# Backup Database
docker exec whatsapp-postgres-$INSTANCE_NUM pg_dump -U whatsapp_user whatsapp_db_$INSTANCE_NUM > $BACKUP_DIR/db_$DATE.sql

# Backup WAHA sessions
docker cp whatsapp-waha-$INSTANCE_NUM:/app/.sessions $BACKUP_DIR/sessions_$DATE

# Compress
gzip $BACKUP_DIR/db_$DATE.sql
tar -czf $BACKUP_DIR/sessions_$DATE.tar.gz $BACKUP_DIR/sessions_$DATE

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed for instance $INSTANCE_NUM: $BACKUP_DIR"
```

### Backup Semua Instance

```bash
#!/bin/bash
# backup-all-instances.sh

for i in {1..10}; do
    echo "Backing up instance $i..."
    ./backup-instance.sh $i
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
```

### WAHA QR Tidak Muncul

```bash
# Check WAHA logs
docker logs whatsapp-waha-1

# Restart WAHA
docker restart whatsapp-waha-1

# Check WAHA API
curl http://localhost:3100/api/sessions
```

## Best Practices

1. **Resource Limits**
   - Set memory limits di docker-compose.yml untuk setiap service
   - Monitor resource usage secara berkala
   - Scale down instance yang tidak aktif

2. **Security**
   - Gunakan JWT secret berbeda per instance
   - Gunakan WAHA API key berbeda per instance
   - Gunakan database password berbeda per instance

3. **Backup**
   - Backup database setiap hari
   - Backup WAHA sessions setiap hari
   - Test restore procedure secara berkala

4. **Monitoring**
   - Setup monitoring untuk setiap instance
   - Alert jika resource usage tinggi
   - Alert jika instance down

5. **Documentation**
   - Dokumentasikan konfigurasi setiap instance
   - Dokumentasikan port mapping
   - Dokumentasikan domain/subdomain mapping

---

**Selamat Setup Multi-Instance! 🚀**

Ingat: Setiap instance adalah aplikasi lengkap dengan database, WAHA, dan API sendiri!
