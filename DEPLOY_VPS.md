# 🚀 Panduan Deploy ke VPS

## Persiapan VPS

### 1. Pilih VPS Provider

**Recommended Providers:**

| Provider | Harga/bulan | Specs | Link |
|----------|-------------|-------|------|
| DigitalOcean | $6 | 1 vCPU, 2GB RAM | digitalocean.com |
| Vultr | $5 | 1 vCPU, 2GB RAM | vultr.com |
| Contabo | €5 | 4 vCPU, 8GB RAM | contabo.com |
| AWS Lightsail | $5 | 1 vCPU, 2GB RAM | aws.amazon.com/lightsail |

**Untuk 1 Instance:**
- CPU: 2 cores minimum
- RAM: 4GB minimum
- Storage: 20GB SSD
- OS: Ubuntu 22.04 LTS

**Untuk 10 Instances:**
- CPU: 8-16 cores
- RAM: 16-32GB
- Storage: 100GB SSD
- OS: Ubuntu 22.04 LTS

### 2. Setup VPS Pertama Kali

Setelah dapat VPS, login via SSH:

```bash
ssh root@IP_VPS_ANDA
```

### 3. Update System

```bash
# Update packages
apt update && apt upgrade -y

# Install essential tools
apt install -y curl git wget nano
```

### 4. Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

### 5. Setup Firewall

```bash
# Install UFW
apt install -y ufw

# Allow SSH (IMPORTANT!)
ufw allow 22/tcp

# Allow HTTP & HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw enable
ufw status
```

## Deploy Aplikasi

### 1. Clone Project ke VPS

```bash
# Create directory
mkdir -p /opt/whatsapp-campaign
cd /opt/whatsapp-campaign

# Option 1: Upload via SCP dari local
# Di komputer lokal (Windows PowerShell):
scp -r "d:\codecana Dev\cloude sonet\*" root@IP_VPS:/opt/whatsapp-campaign/

# Option 2: Clone dari Git (jika sudah di GitHub)
git clone https://github.com/username/repo.git .
```

### 2. Configure Environment

```bash
cd /opt/whatsapp-campaign

# Copy environment file
cp .env.example .env

# Edit environment untuk production
nano .env
```

**Edit .env untuk Production:**

```env
# Database - Ganti password!
DATABASE_URL=postgresql://whatsapp_user:STRONG_PASSWORD_HERE@postgres:5432/whatsapp_db
POSTGRES_USER=whatsapp_user
POSTGRES_PASSWORD=STRONG_PASSWORD_HERE
POSTGRES_DB=whatsapp_db

# Redis
REDIS_URL=redis://redis:6379

# WAHA
WAHA_URL=http://waha:3000
BACKEND_URL=http://backend:4000

# Backend
BACKEND_PORT=4000
NODE_ENV=production
JWT_SECRET=CHANGE_THIS_TO_RANDOM_SECRET_123456789

# Frontend
NEXT_PUBLIC_API_URL=http://IP_VPS_ANDA:4000
FRONTEND_PORT=3001
```

**Generate Random Secret:**
```bash
openssl rand -base64 32
```

### 3. Build & Start Services

```bash
# Build and start all containers
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Run Database Migration

```bash
# Wait 15 seconds for PostgreSQL to be ready
sleep 15

# Run migration
docker exec whatsapp-backend npx prisma migrate deploy
docker exec whatsapp-backend npx prisma generate
```

### 5. Verify Installation

```bash
# Check all containers running
docker-compose ps

# Test backend
curl http://localhost:4000/health

# Test frontend
curl http://localhost:3001
```

## Setup Domain (Opsional tapi Recommended)

### 1. Point Domain ke VPS

Di DNS provider (Cloudflare, Namecheap, dll):
```
Type: A Record
Name: wa.yourdomain.com
Value: IP_VPS_ANDA
TTL: Auto
```

### 2. Install Nginx (jika belum)

```bash
apt install -y nginx
```

### 3. Configure Nginx

```bash
nano /etc/nginx/sites-available/whatsapp-campaign
```

```nginx
server {
    listen 80;
    server_name wa.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /webhook/ {
        proxy_pass http://localhost:4000/webhook/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/whatsapp-campaign /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Reload nginx
systemctl reload nginx
```

### 4. Install SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d wa.yourdomain.com

# Auto-renewal test
certbot renew --dry-run
```

## Auto-Start on Reboot

```bash
# Create systemd service
nano /etc/systemd/system/whatsapp-campaign.service
```

```ini
[Unit]
Description=WhatsApp Campaign Manager
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/whatsapp-campaign
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
# Enable service
systemctl enable whatsapp-campaign
systemctl start whatsapp-campaign
systemctl status whatsapp-campaign
```

## Backup Automation

### 1. Create Backup Script

```bash
nano /opt/backup-whatsapp.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/backups"
mkdir -p $BACKUP_DIR

# Backup Database
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db > $BACKUP_DIR/db_$DATE.sql

# Compress
gzip $BACKUP_DIR/db_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +7 -delete

echo "Backup completed: db_$DATE.sql.gz"
```

```bash
chmod +x /opt/backup-whatsapp.sh
```

### 2. Setup Cron Job

```bash
crontab -e
```

Add this line (backup daily at 2 AM):
```cron
0 2 * * * /opt/backup-whatsapp.sh >> /var/log/whatsapp-backup.log 2>&1
```

## Monitoring

### 1. Resource Monitoring

```bash
# Install htop
apt install -y htop

# Monitor resources
htop

# Docker stats
docker stats

# Disk usage
df -h
```

### 2. Application Logs

```bash
# Real-time logs
docker-compose logs -f

# Specific service
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100

# Save logs
docker-compose logs > /var/log/whatsapp-app.log
```

### 3. Setup Log Rotation

```bash
nano /etc/logrotate.d/whatsapp-campaign
```

```
/var/log/whatsapp-*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

## Troubleshooting di VPS

### Container tidak start

```bash
# Check logs
docker-compose logs

# Restart services
docker-compose restart

# Rebuild
docker-compose down
docker-compose up -d --build
```

### Low Memory

```bash
# Check memory
free -h

# Clean Docker
docker system prune -a

# Restart Docker
systemctl restart docker
```

### Port Already in Use

```bash
# Check what's using port
netstat -tlnp | grep :3001

# Kill process
kill -9 PID
```

## Security Best Practices

### 1. Change Default Passwords

```bash
# Edit .env
nano .env

# Change POSTGRES_PASSWORD
# Change JWT_SECRET
```

### 2. Disable Root Login

```bash
# Create new user
adduser deployuser
usermod -aG sudo deployuser
usermod -aG docker deployuser

# Edit SSH config
nano /etc/ssh/sshd_config

# Change:
PermitRootLogin no
PasswordAuthentication no

# Restart SSH
systemctl restart sshd
```

### 3. Setup Fail2Ban

```bash
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

## Update & Maintenance

### Update Application

```bash
cd /opt/whatsapp-campaign

# Pull latest changes (if using Git)
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Run new migrations
docker exec whatsapp-backend npx prisma migrate deploy
```

### Update Docker Images

```bash
docker-compose pull
docker-compose up -d
```

## Multi-Instance Setup (10 Instances)

### Method 1: Multiple Directories

```bash
# Create 10 directories
for i in {1..10}; do
  cp -r /opt/whatsapp-campaign /opt/whatsapp-instance-$i
  cd /opt/whatsapp-instance-$i
  
  # Edit ports in docker-compose.yml
  sed -i "s/3001:3001/300$i:3001/" docker-compose.yml
  sed -i "s/4000:4000/400$i:4000/" docker-compose.yml
  sed -i "s/3000:3000/310$i:3000/" docker-compose.yml
  
  # Start
  docker-compose up -d
done
```

### Method 2: Nginx Subdomains

Setup DNS:
```
wa1.yourdomain.com → IP_VPS
wa2.yourdomain.com → IP_VPS
...
wa10.yourdomain.com → IP_VPS
```

Nginx config:
```nginx
# wa1.yourdomain.com
server {
    listen 80;
    server_name wa1.yourdomain.com;
    location / { proxy_pass http://localhost:3001; }
}

# wa2.yourdomain.com
server {
    listen 80;
    server_name wa2.yourdomain.com;
    location / { proxy_pass http://localhost:3002; }
}

# ... dst untuk 10 instances
```

## Costs Estimation

### Single Instance
- VPS: $5-6/month
- Domain: $10/year
- **Total: ~$6/month**

### 10 Instances
- VPS (16GB RAM): $30-50/month
- Domain: $10/year
- **Total: ~$35-50/month**

## Checklist Deploy

- [ ] VPS ready dengan Ubuntu 22.04
- [ ] Docker & Docker Compose installed
- [ ] Firewall configured (UFW)
- [ ] Project uploaded ke VPS
- [ ] .env configured dengan password kuat
- [ ] docker-compose up -d berhasil
- [ ] Database migration running
- [ ] Aplikasi accessible via browser
- [ ] Domain pointed (opsional)
- [ ] Nginx configured (opsional)
- [ ] SSL certificate installed (opsional)
- [ ] Auto-start service enabled
- [ ] Backup cron job configured
- [ ] Monitoring setup

## Support Commands

```bash
# Quick restart
cd /opt/whatsapp-campaign && docker-compose restart

# View all logs
docker-compose logs -f

# Database backup manual
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db > backup.sql

# Check disk space
df -h

# Clean Docker
docker system prune -a

# Reboot VPS
reboot
```

---

**Selamat Deploy! 🚀**

Jika ada masalah, cek logs: `docker-compose logs -f`
