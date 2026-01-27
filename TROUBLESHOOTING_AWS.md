# Troubleshooting AWS Deployment Errors

## Error yang Terjadi

Berdasarkan screenshot, ada beberapa error:

1. ✅ **FIXED**: Warning `version` is obsolete - Sudah diperbaiki
2. ❌ **JWT_SECRET tidak di-set** - Backend gagal start
3. ❌ **WAHA_API_KEY tidak di-set** - Backend gagal start
4. ❌ **Backend container unhealthy** - Karena environment variables tidak lengkap

## Solusi: Setup Environment Variables

### Step 1: Buat file .env.aws di VPS

```bash
# Di VPS, masuk ke direktori project
cd /path/to/brdcst

# Copy example file
cp .env.aws.example .env.aws

# Edit file
nano .env.aws
```

### Step 2: Isi dengan nilai yang benar

**PENTING**: Ganti semua nilai `CHANGE_THIS_*` dengan nilai yang aman!

```bash
# ============================================
# Database Configuration
# ============================================
POSTGRES_USER=whatsapp_user
POSTGRES_PASSWORD=YourSecurePassword123!@#
POSTGRES_DB=whatsapp_db

# ============================================
# Redis Configuration
# ============================================
REDIS_PASSWORD=YourRedisPassword456!@#

# ============================================
# WAHA Configuration
# ============================================
# Gunakan WAHA_API_KEY yang sama dari .env lama
WAHA_API_KEY=116e0222dfb5d86824e45ee9488d931b2b8924b63eb3766e1fb633ef3c934289

# Gunakan WAHA_LICENSE_KEY yang sudah ada
WAHA_LICENSE_KEY=your-actual-waha-license-key

# ============================================
# Backend Configuration
# ============================================
# Gunakan JWT_SECRET yang sama dari .env lama
JWT_SECRET=63aeedb737cd1470c76cf13c5dfd5a37f06b2c44a8174c98fbd0a78d5df973f23a3a565bbab66817b0fa0558a2e2e671313bca3a23ffe6b13f8a40a9251d6260

NODE_ENV=production

# ============================================
# Domain Configuration
# ============================================
FRONTEND_DOMAIN=app0.watrix.online
BACKEND_DOMAIN=api0.watrix.online

# ============================================
# AWS Region
# ============================================
AWS_REGION=ap-southeast-1
```

### Step 3: Copy dari .env lama (RECOMMENDED)

Jika Anda sudah punya file `.env` yang working, copy nilai-nilai penting:

```bash
# Di VPS
cd /path/to/brdcst

# Lihat nilai dari .env lama
cat backend/.env

# Copy nilai-nilai ini ke .env.aws:
# - WAHA_API_KEY
# - JWT_SECRET
# - POSTGRES_PASSWORD (atau buat baru yang lebih aman)
# - REDIS_PASSWORD (buat baru)
```

### Step 4: Verify file .env.aws

```bash
# Check apakah file ada
ls -la .env.aws

# Check isinya (pastikan tidak ada CHANGE_THIS_*)
cat .env.aws | grep CHANGE_THIS

# Jika masih ada CHANGE_THIS, berarti belum diganti!
```

### Step 5: Cleanup dan Deploy Ulang

```bash
# Stop semua container
sudo docker compose -f docker-compose.aws.yml down

# Hapus container yang error
sudo docker compose -f docker-compose.aws.yml rm -f

# Deploy ulang
./deploy-aws.sh
```

## Quick Fix Commands

Jika ingin cepat, jalankan ini di VPS:

```bash
# 1. Masuk ke direktori project
cd /path/to/brdcst

# 2. Buat .env.aws dengan nilai dari .env lama
cat > .env.aws << 'EOF'
POSTGRES_USER=whatsapp_user
POSTGRES_PASSWORD=whatsapp_pass
POSTGRES_DB=whatsapp_db
REDIS_PASSWORD=redis_secure_password_123
WAHA_API_KEY=116e0222dfb5d86824e45ee9488d931b2b8924b63eb3766e1fb633ef3c934289
WAHA_LICENSE_KEY=your-waha-license-key-here
JWT_SECRET=63aeedb737cd1470c76cf13c5dfd5a37f06b2c44a8174c98fbd0a78d5df973f23a3a565bbab66817b0fa0558a2e2e671313bca3a23ffe6b13f8a40a9251d6260
NODE_ENV=production
FRONTEND_DOMAIN=app0.watrix.online
BACKEND_DOMAIN=api0.watrix.online
AWS_REGION=ap-southeast-1
EOF

# 3. Cleanup
sudo docker compose -f docker-compose.aws.yml down
sudo docker compose -f docker-compose.aws.yml rm -f

# 4. Deploy ulang
./deploy-aws.sh
```

## Verify Deployment

Setelah deploy ulang, check status:

```bash
# Check semua container
sudo docker compose -f docker-compose.aws.yml ps

# Yang harus HEALTHY:
# - whatsapp-postgres (Healthy)
# - whatsapp-redis (Healthy)
# - whatsapp-waha (Healthy)
# - whatsapp-backend (Healthy)
# - whatsapp-frontend (Healthy)
# - whatsapp-nginx (Healthy)

# Check logs jika ada yang error
sudo docker compose -f docker-compose.aws.yml logs backend
sudo docker compose -f docker-compose.aws.yml logs waha
```

## Common Errors

### Error: "JWT_SECRET variable is not set"
**Solusi**: Tambahkan `JWT_SECRET` ke `.env.aws`

### Error: "WAHA_API_KEY variable is not set"
**Solusi**: Tambahkan `WAHA_API_KEY` ke `.env.aws`

### Error: "dependency failed to start: container whatsapp-backend is unhealthy"
**Solusi**: 
1. Check logs: `sudo docker compose -f docker-compose.aws.yml logs backend`
2. Pastikan semua environment variables sudah di-set
3. Restart: `sudo docker compose -f docker-compose.aws.yml restart backend`

### Error: Redis connection refused
**Solusi**: Pastikan `REDIS_PASSWORD` di `.env.aws` sama dengan yang di docker-compose

## Next Steps

Setelah semua container HEALTHY:

1. ✅ Configure Nginx Proxy Manager
2. ✅ Test frontend: `curl http://localhost:8080`
3. ✅ Test backend: `curl http://localhost:8081/health`
4. ✅ Setup SSL di Nginx Proxy Manager
5. ✅ Test production: `curl https://app0.watrix.online`
