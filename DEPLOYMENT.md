# Multi-Instance Deployment Guide

Untuk menjalankan 10 instance WhatsApp API dalam 1 VPS, ikuti panduan berikut:

## Metode 1: Multiple Docker Compose Files

Buat folder terpisah untuk setiap instance:

```bash
mkdir -p /opt/whatsapp-instances/instance-{1..10}
```

Copy project ke setiap folder dan edit `.env` dengan port berbeda:

### Instance 1 (.env)
```
FRONTEND_PORT=3001
BACKEND_PORT=4001
WAHA_PORT=3000
POSTGRES_PORT=5432
REDIS_PORT=6379
```

### Instance 2 (.env)
```
FRONTEND_PORT=3002
BACKEND_PORT=4002
WAHA_PORT=3100
POSTGRES_PORT=5433
REDIS_PORT=6380
```

Dan seterusnya...

## Metode 2: Nginx Reverse Proxy dengan Subdomain

Edit nginx configuration untuk routing berbasis subdomain:

```nginx
# /etc/nginx/sites-enabled/whatsapp-instances

# Instance 1
server {
    listen 80;
    server_name wa1.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3001;
    }
}

# Instance 2
server {
    listen 80;
    server_name wa2.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3002;
    }
}

# ... dan seterusnya untuk instance 3-10
```

## Metode 3: Path-Based Routing

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location /instance1/ {
        proxy_pass http://localhost:3001/;
    }
    
    location /instance2/ {
        proxy_pass http://localhost:3002/;
    }
    
    # ... dan seterusnya
}
```

## Resource Requirements

Untuk 10 instance, rekomendasi minimum VPS:
- **CPU**: 8 cores
- **RAM**: 16GB
- **Storage**: 100GB SSD
- **Bandwidth**: 1TB/month

## Monitoring

Install monitoring tools:

```bash
# Docker stats untuk semua container
docker stats

# Htop untuk CPU/Memory
sudo apt install htop
htop
```

## Auto-restart on Failure

Tambahkan di docker-compose.yml:

```yaml
services:
  backend:
    restart: always
  frontend:
    restart: always
  waha:
    restart: always
```

## Backup Strategy

Setup automated backup untuk database:

```bash
# Backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db > backup_$DATE.sql
```

## Scaling Tips

1. Gunakan Redis Cluster untuk shared queue
2. PostgreSQL dengan read replicas
3. Load balancer untuk distribusi traffic
4. CDN untuk static assets
