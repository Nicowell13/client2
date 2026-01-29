# Multi-Instance Deployment Guide

## Overview

Konfigurasi untuk menjalankan 4 instance WhatsApp Campaign Manager pada 1 VPS (8 core, 32GB RAM).

**PENTING**: Instance 0 (app0.watrix.online) sudah ada dan menggunakan port 8080/8081. Jangan dihapus!

## Port Mapping

| Instance | Frontend Port | Backend Port | Domain |
|----------|---------------|--------------|--------|
| 0 (existing) | 8080 | 8081 | app0.watrix.online / api0.watrix.online |
| 1 | 8180 | 8181 | app1.watrix.online / api1.watrix.online |
| 2 | 8280 | 8281 | app2.watrix.online / api2.watrix.online |
| 3 | 8380 | 8381 | app3.watrix.online / api3.watrix.online |

## Resource Allocation per Instance

| Service | CPU | Memory |
|---------|-----|--------|
| PostgreSQL | 0.5 | 512 MB |
| Redis | 0.25 | 256 MB |
| WAHA | 1.5 | 1.5 GB |
| Backend | 1.0 | 1 GB |
| Frontend | 0.5 | 512 MB |
| Nginx | 0.25 | 128 MB |
| **Total** | **4.0** | **~4 GB** |

**Total 4 Instances**: ~16 cores (shared), ~16 GB RAM

## Quick Start

### 1. Setup Environment Files

```bash
cd /opt/waha

# Edit setiap file environment
nano instances/.env.instance1
nano instances/.env.instance2
nano instances/.env.instance3
nano instances/.env.instance4
```

Ganti semua nilai `CHANGE_THIS_*` dengan nilai yang aman.

### 2. Build Images (Sekali Saja)

```bash
chmod +x deploy-multi.sh
./deploy-multi.sh build
```

### 3. Deploy New Instances (1, 2, 3)

```bash
# Instance 0 sudah running, deploy instance baru saja
./deploy-multi.sh deploy 1
./deploy-multi.sh deploy 2
./deploy-multi.sh deploy 3
```

### 4. Check Status

```bash
./deploy-multi.sh status all
```

## Management Commands

```bash
# Deploy instance tertentu
./deploy-multi.sh deploy 1

# Stop instance tertentu
./deploy-multi.sh stop 2

# Restart instance tertentu
./deploy-multi.sh restart 3

# Lihat logs instance tertentu
./deploy-multi.sh logs 4

# Deploy semua
./deploy-multi.sh deploy all

# Stop semua
./deploy-multi.sh stop all

# Status semua
./deploy-multi.sh status all
```

## Nginx Proxy Manager Configuration

Tambahkan 6 proxy hosts baru di NPM (app0 sudah ada):

### Instance 1
| Domain | Destination |
|--------|-------------|
| app1.watrix.online | http://127.0.0.1:8180 |
| api1.watrix.online | http://127.0.0.1:8181 |

### Instance 2
| Domain | Destination |
|--------|-------------|
| app2.watrix.online | http://127.0.0.1:8280 |
| api2.watrix.online | http://127.0.0.1:8281 |

### Instance 3
| Domain | Destination |
|--------|-------------|
| app3.watrix.online | http://127.0.0.1:8380 |
| api3.watrix.online | http://127.0.0.1:8381 |

## AWS Security Group

Tambahkan rules berikut di AWS Console (EC2 > Security Groups > Edit Inbound Rules):

| Type | Port Range | Source | Description |
|------|------------|--------|-------------|
| Custom TCP | 8180-8181 | 0.0.0.0/0 | Instance 1 |
| Custom TCP | 8280-8281 | 0.0.0.0/0 | Instance 2 |
| Custom TCP | 8380-8381 | 0.0.0.0/0 | Instance 3 |

**Port 80, 443, 8080, 8081 sudah ada dari sebelumnya.**

## Monitoring

### Check Resource Usage

```bash
# Lihat penggunaan resource semua container
docker stats

# Lihat penggunaan disk
df -h

# Lihat memory
free -h
```

### Check Instance Health

```bash
# Test setiap instance
curl http://localhost:8080   # Instance 1 frontend
curl http://localhost:8081/health   # Instance 1 backend

curl http://localhost:8180   # Instance 2 frontend
curl http://localhost:8181/health   # Instance 2 backend

curl http://localhost:8280   # Instance 3 frontend
curl http://localhost:8281/health   # Instance 3 backend

curl http://localhost:8380   # Instance 4 frontend
curl http://localhost:8381/health   # Instance 4 backend
```

## Backup

Backup bisa dilakukan per instance:

```bash
# Backup database instance 1
docker exec whatsapp-postgres-1 pg_dump -U whatsapp_user whatsapp_db > backup_instance1.sql

# Backup database instance 2
docker exec whatsapp-postgres-2 pg_dump -U whatsapp_user whatsapp_db > backup_instance2.sql

# dst...
```

## Troubleshooting

### Instance tidak start?

```bash
# Lihat logs
./deploy-multi.sh logs 1

# Restart instance
./deploy-multi.sh restart 1
```

### Resource tidak cukup?

```bash
# Stop instance yang tidak digunakan
./deploy-multi.sh stop 4

# Atau kurangi resource limits di docker-compose.multi.yml
```

### Port conflict?

```bash
# Check port yang digunakan
sudo ss -tlnp | grep -E "80|81"

# Pastikan tidak ada service lain menggunakan port yang sama
```

## File Structure

```
/opt/waha/
├── docker-compose.multi.yml    # Multi-instance compose file
├── deploy-multi.sh             # Management script
├── instances/
│   ├── .env.instance1          # Config instance 1
│   ├── .env.instance2          # Config instance 2
│   ├── .env.instance3          # Config instance 3
│   └── .env.instance4          # Config instance 4
├── backend/
├── frontend/
└── nginx/
```
