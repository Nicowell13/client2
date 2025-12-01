# 🚀 Watrix.online Deployment Guide

## Quick Overview
- **Frontend Domain**: `app.watrix.online`
- **Backend API Domain**: `api.watrix.online`
- **Delay System**: 7-9 detik antar pesan + 10-15 detik per 10 pesan
- **Multi-Instance**: Mendukung hingga 10 instances dalam 1 VPS

---

## 📋 Prerequisites Checklist

- [ ] VPS Ubuntu 20.04/22.04 dengan minimum 4GB RAM (16GB untuk 10 instances)
- [ ] Domain watrix.online dengan akses DNS management
- [ ] Root/sudo access ke VPS
- [ ] SSH key untuk koneksi aman

---

## 🌐 Step 1: DNS Configuration

Login ke DNS provider (Cloudflare/Namecheap/dll) dan tambahkan A records:

### Untuk Single Instance
```
Type: A, Name: app, Value: VPS_IP_ADDRESS, TTL: Auto
Type: A, Name: api, Value: VPS_IP_ADDRESS, TTL: Auto
```

### Untuk Multiple Instances (10 instances)
```
app1.watrix.online → VPS_IP
api1.watrix.online → VPS_IP
app2.watrix.online → VPS_IP
api2.watrix.online → VPS_IP
... hingga app10 & api10
```

Tunggu 5-10 menit untuk DNS propagation. Verify dengan:
```bash
ping app.watrix.online
ping api.watrix.online
```

---

## 📦 Step 2: Upload Project ke VPS

### Option A: Via Git (Recommended)
```bash
# SSH ke VPS
ssh root@YOUR_VPS_IP

# Install git
sudo apt update
sudo apt install -y git

# Clone project
cd /opt
git clone https://github.com/yourusername/whatsapp-campaign.git
cd whatsapp-campaign
```

### Option B: Via SCP dari Windows
```powershell
# Di Windows PowerShell
scp -r "d:\codecana Dev\cloude sonet" root@YOUR_VPS_IP:/opt/whatsapp-campaign
```

---

## ⚙️ Step 3: Configure Environment

```bash
cd /opt/whatsapp-campaign

# Copy production environment
cp .env.production.example .env

# Edit environment variables
nano .env
```

**Update nilai berikut**:
```env
# Database (ganti password!)
POSTGRES_PASSWORD=YOUR_SECURE_PASSWORD_HERE

# WAHA API Key (generate random string)
WAHA_API_KEY=YOUR_RANDOM_API_KEY_HERE

# JWT Secret (generate random string)
JWT_SECRET=YOUR_RANDOM_JWT_SECRET_HERE

# Production URLs
BACKEND_URL=https://api.watrix.online
NEXT_PUBLIC_API_URL=https://api.watrix.online
```

Generate secure random strings:
```bash
# Generate WAHA API Key
openssl rand -hex 32

# Generate JWT Secret
openssl rand -hex 64
```

---

## 🚀 Step 4: Deploy dengan Setup Script

```bash
# Berikan permission
chmod +x setup-vps.sh

# Jalankan automatic setup
sudo ./setup-vps.sh
```

Script akan:
1. ✅ Install Docker & Docker Compose
2. ✅ Build semua services (PostgreSQL, Redis, WAHA, Backend, Frontend)
3. ✅ Run database migrations
4. ✅ Create admin user default
5. ✅ Configure UFW firewall
6. ✅ Show access information

---

## 🔒 Step 5: Setup Nginx & SSL

### Install Nginx & Certbot
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Copy Nginx Configuration
```bash
sudo cp nginx-watrix.conf /etc/nginx/sites-available/watrix
sudo ln -s /etc/nginx/sites-available/watrix /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
```

### Install SSL Certificates
```bash
# Frontend SSL
sudo certbot --nginx -d app.watrix.online

# Backend SSL
sudo certbot --nginx -d api.watrix.online
```

Pilih option:
- Email: your@email.com
- Agree to ToS: Yes
- Redirect HTTP to HTTPS: Yes (option 2)

### Restart Nginx
```bash
sudo systemctl restart nginx
```

---

## ✅ Step 6: Verify Deployment

### Check Services
```bash
# Check Docker containers
docker compose ps

# All containers should show "Up"
# postgres, redis, waha, backend, frontend
```

### Test Endpoints

**Frontend**:
```bash
curl https://app.watrix.online
# Should return HTML
```

**Backend API**:
```bash
curl https://api.watrix.online/api/health
# Should return: {"status":"ok"}
```

**Login Test**:
- Open: https://app.watrix.online
- Email: `admin@example.com`
- Password: `admin123`

**🔴 PENTING**: Segera ganti password default setelah login pertama!

---

## 🔄 Step 7: Update Production Environment

```bash
# Stop services
sudo docker compose down

# Update .env dengan domain production
sudo nano .env
```

Pastikan nilai berikut sudah benar:
```env
BACKEND_URL=https://api.watrix.online
NEXT_PUBLIC_API_URL=https://api.watrix.online
```

```bash
# Rebuild dengan environment baru
sudo docker compose up -d --build

# Verify
docker compose logs -f backend
```

---

## ⏱️ Message Delay System

Sistem delay sudah dikonfigurasi otomatis:

### Cara Kerja
1. **Delay Antar Pesan**: 7-9 detik (random)
2. **Delay Batch**: 10-15 detik tambahan setiap 10 pesan
3. **Concurrency**: Maksimal 5 pesan parallel

### Timeline Example (100 kontak)
```
Pesan 1:   Delay ~8 detik
Pesan 2:   Delay ~7 detik
...
Pesan 10:  Delay ~9 detik
Pesan 11:  Delay ~20 detik (base 8 + batch 12)
Pesan 12:  Delay ~18 detik (base 7 + batch 11)
...
Pesan 20:  Delay ~21 detik
Pesan 21:  Delay ~32 detik (base 8 + 2x batch)
...
Total: ~45-60 menit untuk 100 pesan
```

### Monitor Progress
```bash
# Lihat real-time logs
docker compose logs -f backend

# Output akan menampilkan:
# Delaying message 1 for campaign xxx by 7234ms
# Delaying message 11 for campaign xxx by 19456ms
```

---

## 🔐 Step 8: Security Hardening

### 1. Change Default Admin Password
```bash
# Login ke frontend
# Settings → Change Password
```

### 2. Create Additional Users (via curl)
```bash
# Create user via API
curl -X POST https://api.watrix.online/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user1@watrix.online",
    "password": "SecurePassword123!",
    "name": "User 1",
    "role": "user"
  }'
```

### 3. Disable SSH Root Login
```bash
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd
```

### 4. Setup Firewall
```bash
# Already configured by setup script
sudo ufw status

# Should show:
# 22/tcp    ALLOW
# 80/tcp    ALLOW
# 443/tcp   ALLOW
```

### 5. Install Fail2Ban
```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## 📊 Step 9: Setup Monitoring & Backup

### Daily Auto Backup
```bash
# Test backup script
./backup.sh

# Setup cron untuk daily backup (3 AM)
sudo crontab -e

# Tambahkan line:
0 3 * * * /opt/whatsapp-campaign/backup.sh
```

Backup location: `/opt/backups/whatsapp-campaign/`
Retention: 7 days

### Monitor Resources
```bash
# Install htop
sudo apt install -y htop

# Monitor real-time
htop

# Docker stats
docker stats
```

---

## 🎯 Single Instance Complete Checklist

- [ ] DNS configured (app & api pointing to VPS)
- [ ] Project uploaded to VPS
- [ ] .env configured with secure passwords
- [ ] setup-vps.sh executed successfully
- [ ] Nginx installed and configured
- [ ] SSL certificates installed (both domains)
- [ ] All services running (docker compose ps)
- [ ] Frontend accessible at https://app.watrix.online
- [ ] Backend API working at https://api.watrix.online
- [ ] Admin login successful
- [ ] Default password changed
- [ ] Backup cron configured
- [ ] Firewall active (ufw status)

---

## 🔢 Multiple Instances (Advanced)

Untuk menjalankan 10 instances, ikuti panduan di `VPS_DEPLOY.md` section "Scaling untuk Multiple Instances".

**Resource Requirements**:
- RAM: 16GB
- CPU: 4-8 cores
- Storage: 40GB
- 20 SSL certificates (10 app + 10 api subdomains)

---

## 🚨 Troubleshooting

### Services Not Starting
```bash
# Check logs
docker compose logs

# Rebuild
docker compose down
docker compose up -d --build
```

### SSL Certificate Issues
```bash
# Check Nginx config
sudo nginx -t

# Renew certificates
sudo certbot renew

# Check certificate expiry
sudo certbot certificates
```

### Cannot Access Frontend
```bash
# Check frontend logs
docker compose logs frontend

# Verify Nginx is running
sudo systemctl status nginx

# Test direct port access
curl http://localhost:3001
```

### Database Connection Error
```bash
# Restart PostgreSQL
docker compose restart postgres

# Wait and run migrations
sleep 10
docker exec whatsapp-backend npx prisma migrate deploy
```

### WAHA QR Code Issues
```bash
# Restart WAHA
docker compose restart waha

# Check WAHA status
curl http://localhost:3000/api/sessions
```

### Message Delays Not Working
```bash
# Check backend logs for delay messages
docker compose logs backend | grep "Delaying"

# Verify queue service is running
docker compose logs backend | grep "campaign-messages"
```

---

## 📞 Useful Commands

### Service Management
```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart specific service
docker compose restart backend

# View logs
docker compose logs -f [service]

# Execute command in container
docker exec -it whatsapp-backend sh
```

### Database Management
```bash
# Access PostgreSQL
docker exec -it whatsapp-postgres psql -U whatsapp_user -d whatsapp_db

# Run migrations
docker exec whatsapp-backend npx prisma migrate deploy

# Reset database (DANGER!)
docker compose down -v
docker compose up -d
```

### Backup & Restore
```bash
# Manual backup
./backup.sh

# Restore from backup
docker exec -i whatsapp-postgres psql -U whatsapp_user -d whatsapp_db < backup.sql

# Restore WAHA sessions
docker cp backup_sessions.tar whatsapp-waha:/app/sessions/
```

---

## 📈 Performance Tips

1. **Enable Redis Caching**: Already configured
2. **Use CDN**: Cloudflare for static assets
3. **Database Indexing**: Already optimized in Prisma schema
4. **Monitor Delays**: Adjust delay settings in queue.service.ts if needed
5. **Scale Horizontally**: Use multiple instances for high volume

---

## 💰 Cost Estimation

### Single Instance (1 domain set)
- VPS 4GB RAM: $10-15/month
- Domain watrix.online: $10/year
- SSL: Free (Let's Encrypt)
- **Total**: ~$11-16/month

### 10 Instances (10 domain sets)
- VPS 16GB RAM: $40-60/month
- Domain + subdomains: $10/year
- SSL: Free (Let's Encrypt)
- **Total**: ~$41-61/month

---

## ✅ Deployment Complete!

Selamat! Aplikasi WhatsApp Campaign Manager sudah berjalan di:
- **Frontend**: https://app.watrix.online
- **Backend**: https://api.watrix.online

**Next Steps**:
1. Login dan ganti password default
2. Buat WhatsApp session pertama
3. Scan QR code
4. Upload kontak CSV
5. Buat campaign pertama dengan delay otomatis

**Support**: Check VPS_DEPLOY.md dan COMMANDS.md untuk referensi lengkap.

---

**Made with ❤️ for Watrix.online**
