# WhatsApp Campaign Manager - VPS Deployment Guide

## 🌐 Domain Configuration
- **Frontend**: `app.watrix.online`
- **Backend API**: `api.watrix.online`

## 🚀 Quick Deploy ke VPS Ubuntu

### Prerequisites
- VPS Ubuntu 20.04/22.04 LTS
- Minimum: 2 CPU, 4GB RAM, 20GB Storage
- Root atau sudo access
- 2 Domain/subdomain pointing ke VPS IP:
  - `app.watrix.online` → VPS IP
  - `api.watrix.online` → VPS IP

---

## 📦 Automatic Setup (Recommended)

### 1. Upload Project ke VPS

**Option A: Via Git (Recommended)**
```bash
# Di VPS
sudo apt update
sudo apt install -y git
git clone https://github.com/yourusername/whatsapp-campaign.git
cd whatsapp-campaign
```

**Option B: Via SCP (dari local)**
```bash
# Di Windows PowerShell
scp -r "d:\codecana Dev\cloude sonet" root@YOUR_VPS_IP:/opt/whatsapp-campaign
```

### 2. Run Setup Script
```bash
cd /opt/whatsapp-campaign
chmod +x setup-vps.sh
sudo ./setup-vps.sh
```

Script akan otomatis:
- ✅ Install Docker & Docker Compose
- ✅ Build semua services
- ✅ Setup database & migrations
- ✅ Create admin user
- ✅ Configure firewall
- ✅ Show login info

### 3. Akses Aplikasi
```
http://YOUR_VPS_IP:3001
```

Login:
- Email: `admin@example.com`
- Password: `admin123`

---

## 🔧 Manual Setup (Alternative)

### 1. Install Docker
```bash
# Update packages
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release

# Add Docker repo
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. Upload & Deploy
```bash
# Clone/upload project
cd /opt
sudo git clone <your-repo> whatsapp-campaign
cd whatsapp-campaign

# Start services
sudo docker compose up -d --build

# Wait for database
sleep 20

# Setup database
sudo docker exec whatsapp-backend npx prisma generate
sudo docker exec whatsapp-backend npx prisma migrate deploy

# Create admin
sudo docker exec whatsapp-backend node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@example.com', password: hash, name: 'Admin', role: 'admin' }
  });
  console.log('Admin created!');
  await prisma.\$disconnect();
})();
"
```

### 3. Configure Firewall
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp
sudo ufw allow 4000/tcp
sudo ufw enable
```

---

## 🌐 Setup Domain & SSL (Watrix.online)

### 1. Point Domains ke VPS
Di DNS provider (Cloudflare, Namecheap, dll):
```
Type: A
Name: app
Value: YOUR_VPS_IP
TTL: Auto

Type: A
Name: api
Value: YOUR_VPS_IP
TTL: Auto
```

### 2. Install Nginx
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 3. Configure Nginx
```bash
sudo cp nginx-watrix.conf /etc/nginx/sites-available/watrix
sudo ln -s /etc/nginx/sites-available/watrix /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default config
sudo nginx -t  # Test configuration
```

### 4. Update Environment Variables
```bash
# Edit .env file
sudo nano .env
```

Change these values:
```env
BACKEND_URL=https://api.watrix.online
NEXT_PUBLIC_API_URL=https://api.watrix.online
```

### 5. Install SSL Certificates
```bash
# For app.watrix.online (Frontend)
sudo certbot --nginx -d app.watrix.online

# For api.watrix.online (Backend)
sudo certbot --nginx -d api.watrix.online
```

Certbot akan otomatis configure HTTPS dan redirect HTTP → HTTPS.

### 6. Restart Services
```bash
sudo docker compose down
sudo docker compose up -d
sudo systemctl restart nginx
```

### 7. Akses Aplikasi
- **Frontend**: https://app.watrix.online
- **Backend API**: https://api.watrix.online/api/health

---

## ⏱️ Message Delay System

### Automatic Delay Configuration
System ini sudah dikonfigurasi dengan delay otomatis untuk mencegah spam dan blokir WhatsApp:

**Delay Antar Pesan**: 7-9 detik (random)
- Setiap pesan di-delay secara random antara 7-9 detik
- Membuat pola pengiriman lebih natural

**Delay Batch**: 10-15 detik per 10 pesan
- Setiap 10 pesan, tambahan delay 10-15 detik
- Contoh timeline pengiriman:
  - Pesan 1-10: ~7-9 detik per pesan
  - Pesan 11-20: ~17-24 detik per pesan (base + batch delay)
  - Pesan 21-30: ~27-39 detik per pesan (base + 2x batch delay)

**Concurrency Limit**: Maksimal 5 pesan diproses parallel
- Mencegah overload WAHA service
- Lebih stabil untuk campaign besar

### Estimasi Waktu Campaign
Untuk campaign dengan **100 kontak**:
- Pesan 1-10: ~80 detik (8 detik rata-rata)
- Pesan 11-20: ~200 detik (20 detik rata-rata)
- Pesan 21-30: ~320 detik (32 detik rata-rata)
- Total estimasi: **~45-60 menit**

### Monitor Progress
Lihat log pengiriman:
```bash
docker compose logs -f backend
```

Output akan menampilkan:
```
Delaying message 1 for campaign xxx by 7234ms
Delaying message 11 for campaign xxx by 19456ms
Delaying message 21 for campaign xxx by 31678ms
```

---

## 🔄 Auto Backup Setup

### 1. Setup Backup Script
```bash
cd /opt/whatsapp-campaign
chmod +x backup.sh

# Test backup
sudo ./backup.sh
```

### 2. Schedule Daily Backup (Cron)
```bash
sudo crontab -e
```

Tambahkan:
```cron
# Backup daily at 2 AM
0 2 * * * /opt/whatsapp-campaign/backup.sh >> /var/log/whatsapp-backup.log 2>&1
```

Backups akan tersimpan di `/opt/backups/whatsapp-campaign/`

---

## 🔐 Security Best Practices

### 1. Change Default Passwords
```bash
cd /opt/whatsapp-campaign
nano .env
```

Update:
```env
JWT_SECRET=<random-64-char-string>
WAHA_API_KEY=<random-64-char-string>
POSTGRES_PASSWORD=<strong-password>
```

Restart services:
```bash
sudo docker compose down
sudo docker compose up -d
```

### 2. Disable Root Login
```bash
sudo nano /etc/ssh/sshd_config
```

Set:
```
PermitRootLogin no
PasswordAuthentication no
```

Restart SSH:
```bash
sudo systemctl restart sshd
```

### 3. Install Fail2Ban
```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## 📊 Monitoring & Maintenance

### View Logs
```bash
# All services
sudo docker compose logs -f

# Specific service
sudo docker compose logs -f backend
sudo docker compose logs -f waha

# Check container status
sudo docker compose ps
```

### Resource Monitoring
```bash
# Install htop
sudo apt install -y htop

# Monitor
htop

# Docker stats
sudo docker stats
```

### Restart Services
```bash
# Restart all
sudo docker compose restart

# Restart specific
sudo docker compose restart backend
sudo docker compose restart waha
```

### Update Application
```bash
cd /opt/whatsapp-campaign
git pull
sudo docker compose down
sudo docker compose up -d --build
sudo docker exec whatsapp-backend npx prisma migrate deploy
```

---

## 🚨 Troubleshooting

### Services Won't Start
```bash
# Check logs
sudo docker compose logs

# Rebuild
sudo docker compose down -v
sudo docker compose up -d --build
```

### Out of Memory
```bash
# Check memory
free -h

# Clean Docker
sudo docker system prune -a

# Restart Docker
sudo systemctl restart docker
```

### Database Connection Error
```bash
# Restart PostgreSQL
sudo docker compose restart postgres
sleep 10
sudo docker exec whatsapp-backend npx prisma migrate deploy
```

### WAHA QR Not Working
```bash
# Restart WAHA
sudo docker compose restart waha

# Check WAHA logs
sudo docker compose logs -f waha
```

---

## 📈 Scaling untuk Multiple Instances

Untuk menjalankan 10 instances di 1 VPS dengan domain watrix.online:

### 1. Setup Subdomains di DNS
Tambahkan A records untuk setiap instance:
```
app1.watrix.online → VPS_IP
api1.watrix.online → VPS_IP
app2.watrix.online → VPS_IP
api2.watrix.online → VPS_IP
... (hingga app10 & api10)
```

### 2. Create Multiple Instance Directories
```bash
for i in {1..10}; do
  sudo cp -r /opt/whatsapp-campaign /opt/whatsapp-instance-$i
  cd /opt/whatsapp-instance-$i
  
  # Update ports in docker-compose.yml
  sudo sed -i "s/5432:5432/543$i:5432/" docker-compose.yml  # PostgreSQL
  sudo sed -i "s/6379:6379/637$i:6379/" docker-compose.yml  # Redis
  sudo sed -i "s/3001:3001/300$i:3001/" docker-compose.yml  # Frontend
  sudo sed -i "s/4000:4000/400$i:4000/" docker-compose.yml  # Backend
  sudo sed -i "s/3000:3000/310$i:3000/" docker-compose.yml  # WAHA
  
  # Update container names to avoid conflicts
  sudo sed -i "s/whatsapp-/whatsapp-$i-/g" docker-compose.yml
  
  # Update .env for each instance
  sudo sed -i "s/whatsapp_db/whatsapp_db_$i/" .env
  sudo sed -i "s/admin@example.com/admin$i@watrix.online/" .env
  sudo sed -i "s|api.watrix.online|api$i.watrix.online|g" .env
  
  # Start instance
  sudo docker compose up -d
done
```

### 3. Create Nginx Configuration per Instance
```bash
sudo nano /etc/nginx/sites-available/watrix-multi
```

Paste konfigurasi (contoh untuk instance 1-3, duplikat untuk semua):
```nginx
# Instance 1 - Frontend
server {
    listen 443 ssl http2;
    server_name app1.watrix.online;
    
    ssl_certificate /etc/letsencrypt/live/app1.watrix.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app1.watrix.online/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Instance 1 - Backend
server {
    listen 443 ssl http2;
    server_name api1.watrix.online;
    
    ssl_certificate /etc/letsencrypt/live/api1.watrix.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api1.watrix.online/privkey.pem;
    
    location / {
        proxy_pass http://localhost:4001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}

# Instance 2 - Frontend (port 3002)
server {
    listen 443 ssl http2;
    server_name app2.watrix.online;
    
    ssl_certificate /etc/letsencrypt/live/app2.watrix.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app2.watrix.online/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3002;
        # ... (sama seperti instance 1)
    }
}

# Instance 2 - Backend (port 4002)
server {
    listen 443 ssl http2;
    server_name api2.watrix.online;
    # ... (sama seperti instance 1, ganti port)
}

# ... duplikat untuk instance 3-10
```

### 4. Install SSL untuk Semua Instances
```bash
# Install SSL untuk semua subdomain
for i in {1..10}; do
  sudo certbot --nginx -d app$i.watrix.online
  sudo certbot --nginx -d api$i.watrix.online
done
```

### 5. Resource Requirements per Instance
Per instance membutuhkan:
- **RAM**: ~800MB
- **CPU**: 0.2-0.5 cores
- **Storage**: ~2GB

**Untuk 10 instances**:
- **Total RAM**: 8-12GB (recommended 16GB)
- **Total CPU**: 4-8 cores
- **Total Storage**: 30-40GB

### 6. Akses Instances
- Instance 1: https://app1.watrix.online (API: https://api1.watrix.online)
- Instance 2: https://app2.watrix.online (API: https://api2.watrix.online)
- Instance 3-10: https://app[N].watrix.online

---

## 💰 Cost Estimation

### Single Instance
- **VPS 4GB RAM**: $5-10/month
- **Domain**: $10/year
- **Total**: ~$6-11/month

### 10 Instances
- **VPS 16GB RAM**: $30-50/month
- **Domain**: $10/year
- **Total**: ~$31-51/month

---

## 📞 Support

Jika ada masalah:
1. Check logs: `sudo docker compose logs -f`
2. Restart: `sudo docker compose restart`
3. Rebuild: `sudo docker compose down && sudo docker compose up -d --build`

---

**Selamat Deploy! 🚀**
