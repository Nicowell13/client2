# AWS Deployment Guide - WhatsApp Campaign Manager

## Prerequisites

### 1. AWS EC2 Instance
- **Instance Type**: t3.medium or larger (2 vCPU, 4GB RAM minimum)
- **Storage**: 30GB+ EBS volume
- **OS**: Ubuntu 22.04 LTS
- **Region**: ap-southeast-1 (Singapore)

### 2. Domain Configuration
- Frontend: `app0.watrix.online` → EC2 IP
- Backend: `api0.watrix.online` → EC2 IP

### 3. Required Software
- Docker 24.0+
- Docker Compose 2.20+
- Nginx Proxy Manager (already running at `http://18.142.231.145:81/`)

---

## Security Group Configuration

### Inbound Rules
```
Port 22   (SSH)     - Your IP only (for management)
Port 80   (HTTP)    - 0.0.0.0/0 (Nginx Proxy Manager)
Port 443  (HTTPS)   - 0.0.0.0/0 (Nginx Proxy Manager)
Port 8080 (Custom)  - Nginx Proxy Manager IP only
Port 8081 (Custom)  - Nginx Proxy Manager IP only
```

### Outbound Rules
```
All traffic - 0.0.0.0/0
```

---

## Installation Steps

### Step 1: Connect to EC2 Instance

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

### Step 2: Install Docker and Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version

# Logout and login again for group changes to take effect
exit
```

### Step 3: Clone Repository

```bash
# SSH back in
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Clone your repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### Step 4: Configure Environment Variables

```bash
# Copy example file
cp .env.aws.example .env.aws

# Edit with your actual values
nano .env.aws
```

**Important values to change:**
```bash
POSTGRES_PASSWORD=your_secure_password_here
REDIS_PASSWORD=your_redis_password_here
WAHA_API_KEY=your_waha_api_key_here
WAHA_LICENSE_KEY=your_waha_license_key_here
JWT_SECRET=your_long_random_jwt_secret_at_least_64_characters
```

### Step 5: Deploy Application

```bash
# Make deployment script executable
chmod +x deploy-aws.sh

# Run deployment
./deploy-aws.sh
```

### Step 6: Configure Nginx Proxy Manager

1. **Access Nginx Proxy Manager**: http://18.142.231.145:81/

2. **Add Frontend Proxy Host**:
   - Domain: `app0.watrix.online`
   - Scheme: `http`
   - Forward Hostname/IP: `YOUR_EC2_IP`
   - Forward Port: `8080`
   - Enable: ✅ Block Common Exploits
   - Enable: ✅ Websockets Support
   - SSL: Request new SSL certificate (Let's Encrypt)

3. **Add Backend Proxy Host**:
   - Domain: `api0.watrix.online`
   - Scheme: `http`
   - Forward Hostname/IP: `YOUR_EC2_IP`
   - Forward Port: `8081`
   - Enable: ✅ Block Common Exploits
   - Enable: ✅ Websockets Support
   - SSL: Request new SSL certificate (Let's Encrypt)

### Step 7: Verify Deployment

```bash
# Check service status
docker-compose -f docker-compose.aws.yml ps

# View logs
docker-compose -f docker-compose.aws.yml logs -f

# Test frontend
curl http://localhost:8080

# Test backend
curl http://localhost:8081/health
```

---

## Post-Deployment

### Setup Automated Backups

```bash
# Make backup script executable
chmod +x backup-aws.sh

# Test backup
./backup-aws.sh

# Add to crontab for daily backups at 2 AM
crontab -e

# Add this line:
0 2 * * * /home/ubuntu/YOUR_REPO/backup-aws.sh >> /var/log/backup.log 2>&1
```

### Monitor Services

```bash
# View all logs
docker-compose -f docker-compose.aws.yml logs -f

# View specific service logs
docker-compose -f docker-compose.aws.yml logs -f backend
docker-compose -f docker-compose.aws.yml logs -f waha

# Check resource usage
docker stats
```

### Restart Services

```bash
# Restart all services
docker-compose -f docker-compose.aws.yml restart

# Restart specific service
docker-compose -f docker-compose.aws.yml restart backend
```

---

## Troubleshooting

### Services Not Starting

```bash
# Check logs
docker-compose -f docker-compose.aws.yml logs

# Check if ports are in use
sudo netstat -tulpn | grep -E '8080|8081'

# Restart Docker
sudo systemctl restart docker
```

### Database Connection Issues

```bash
# Check PostgreSQL health
docker-compose -f docker-compose.aws.yml exec postgres pg_isready -U whatsapp_user

# Access PostgreSQL shell
docker-compose -f docker-compose.aws.yml exec postgres psql -U whatsapp_user -d whatsapp_db
```

### WAHA Not Connecting

```bash
# Check WAHA logs
docker-compose -f docker-compose.aws.yml logs -f waha

# Restart WAHA
docker-compose -f docker-compose.aws.yml restart waha

# Check WAHA health
curl http://localhost:3000/health
```

### SSL Certificate Issues

1. Ensure DNS is pointing to correct IP
2. Wait 5-10 minutes for DNS propagation
3. Try requesting certificate again in Nginx Proxy Manager
4. Check Nginx Proxy Manager logs

---

## Maintenance

### Update Application

```bash
cd /home/ubuntu/YOUR_REPO
./deploy-aws.sh
```

### View Disk Usage

```bash
# Check Docker disk usage
docker system df

# Clean up unused images/containers
docker system prune -a
```

### Backup Before Updates

```bash
# Always backup before major updates
./backup-aws.sh
```

---

## Security Best Practices

1. ✅ **Never expose database ports** to the internet
2. ✅ **Use strong passwords** for all services
3. ✅ **Enable UFW firewall** on EC2
4. ✅ **Regular backups** to S3 or external storage
5. ✅ **Monitor logs** for suspicious activity
6. ✅ **Keep Docker images updated**
7. ✅ **Use SSH keys** instead of passwords

---

## Architecture Overview

```
Internet
   ↓
Nginx Proxy Manager (18.142.231.145:81)
   ↓
   ├─→ app0.watrix.online → EC2:8080 → Nginx → Frontend:3001
   └─→ api0.watrix.online → EC2:8081 → Nginx → Backend:4000
                                                    ↓
                                              WAHA:3000 (internal)
                                              PostgreSQL:5432 (internal)
                                              Redis:6379 (internal)
```

**Key Security Features**:
- ✅ Only ports 8080 and 8081 exposed to Nginx Proxy Manager
- ✅ Database and Redis NOT accessible from outside
- ✅ WAHA NOT accessible from outside
- ✅ All traffic encrypted via SSL/TLS
- ✅ Health checks for automatic recovery
- ✅ Resource limits to prevent resource exhaustion

---

## Support

For issues or questions:
1. Check logs: `docker-compose -f docker-compose.aws.yml logs -f`
2. Check service status: `docker-compose -f docker-compose.aws.yml ps`
3. Review this guide
4. Check WAHA documentation: https://waha.devlike.pro/
