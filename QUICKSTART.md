# 🚀 Quick Start Guide

## Cara Paling Mudah (Recommended)

### Windows
```powershell
.\quick-start.bat
```

Script ini akan otomatis:
- ✅ Build & start semua services
- ✅ Setup database & migrations  
- ✅ Create admin user
- ✅ Show login info

**Login:**
- URL: **http://localhost:3001**
- Email: `admin@example.com`
- Password: `admin123`

---

## Manual Setup

### 1. Start Services
```powershell
docker-compose up -d --build
```

### 2. Wait & Setup Database
```powershell
# Wait 15 seconds
Start-Sleep 15

# Generate Prisma
docker exec whatsapp-backend npx prisma generate

# Run migrations
docker exec whatsapp-backend npx prisma migrate deploy
```

### 3. Create Admin User
```powershell
docker exec whatsapp-backend node -e "const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcryptjs'); const prisma = new PrismaClient(); (async () => { const hash = await bcrypt.hash('admin123', 10); await prisma.user.create({ data: { email: 'admin@example.com', password: hash, name: 'Admin', role: 'admin' } }); console.log('Admin created!'); await prisma.\$disconnect(); })();"
```

### 4. Access Application
Open: **http://localhost:3001**

---

## Troubleshooting

### "Docker command not found"
Install Docker Desktop: https://www.docker.com/products/docker-desktop/

### "Port already in use"
```powershell
# Kill processes
taskkill /F /IM node.exe
docker-compose down
docker-compose up -d
```

### "Cannot connect to database"
```powershell
# Restart PostgreSQL
docker-compose restart postgres
Start-Sleep 10
docker exec whatsapp-backend npx prisma migrate deploy
```

### "WAHA QR not showing"
```powershell
# Restart WAHA
docker-compose restart waha

# View WAHA logs
docker-compose logs -f waha
```

---

## Common Commands

```powershell
# View all logs
docker-compose logs -f

# Stop all
docker-compose down

# Restart all
docker-compose restart

# Clean & rebuild
docker-compose down -v
docker-compose up -d --build
```

---

## Services URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3001 |
| Backend | http://localhost:4000 |
| WAHA | http://localhost:3000 |

---

Untuk dokumentasi lengkap, lihat **COMMANDS.md**
