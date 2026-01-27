# Quick Start - AWS Deployment

## 🚀 Deployment dalam 5 Langkah

### 1. Setup EC2 Instance
```bash
# SSH ke EC2
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### 2. Clone & Configure
```bash
# Clone repository
git clone YOUR_REPO_URL
cd YOUR_REPO

# Setup environment
cp .env.aws.example .env.aws
nano .env.aws  # Edit dengan password yang aman
```

### 3. Deploy
```bash
chmod +x deploy-aws.sh
./deploy-aws.sh
```

### 4. Configure Nginx Proxy Manager
Akses: http://18.142.231.145:81/

**Frontend (app0.watrix.online)**:
- Forward to: `YOUR_EC2_IP:8080`
- Enable SSL (Let's Encrypt)
- Enable WebSockets

**Backend (api0.watrix.online)**:
- Forward to: `YOUR_EC2_IP:8081`
- Enable SSL (Let's Encrypt)
- Enable WebSockets

### 5. Verify
```bash
# Check status
docker-compose -f docker-compose.aws.yml ps

# Test
curl https://app0.watrix.online
curl https://api0.watrix.online/health
```

## 📋 File yang Dibuat

| File | Deskripsi |
|------|-----------|
| `docker-compose.aws.yml` | Production config dengan security hardening |
| `.env.aws.example` | Template environment variables |
| `nginx/nginx-aws.conf` | Nginx config untuk internal routing |
| `deploy-aws.sh` | Script deployment otomatis |
| `backup-aws.sh` | Script backup database |
| `AWS_DEPLOYMENT.md` | Panduan lengkap deployment |

## 🔒 Keamanan

✅ **Database & Redis**: TIDAK exposed ke internet  
✅ **WAHA**: TIDAK exposed ke internet  
✅ **Nginx**: Hanya port 8080 & 8081 exposed ke Nginx Proxy Manager  
✅ **SSL/TLS**: Semua traffic encrypted  
✅ **Health Checks**: Auto-restart jika service crash  
✅ **Resource Limits**: Mencegah resource exhaustion  

## 📊 Monitoring

```bash
# View logs
docker-compose -f docker-compose.aws.yml logs -f

# Check resource usage
docker stats

# Health check
curl http://localhost:8080/health
curl http://localhost:8081/health
```

## 🔄 Backup

```bash
# Manual backup
./backup-aws.sh

# Setup automated daily backup (2 AM)
crontab -e
# Add: 0 2 * * * /path/to/backup-aws.sh >> /var/log/backup.log 2>&1
```

## 🆘 Troubleshooting

**Services tidak start?**
```bash
docker-compose -f docker-compose.aws.yml logs
docker-compose -f docker-compose.aws.yml restart
```

**Database connection error?**
```bash
docker-compose -f docker-compose.aws.yml exec postgres pg_isready -U whatsapp_user
```

**WAHA tidak connect?**
```bash
docker-compose -f docker-compose.aws.yml logs -f waha
docker-compose -f docker-compose.aws.yml restart waha
```

## 📚 Dokumentasi Lengkap

Lihat [AWS_DEPLOYMENT.md](./AWS_DEPLOYMENT.md) untuk panduan lengkap.
