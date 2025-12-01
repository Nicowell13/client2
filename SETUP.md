# Setup Instructions untuk WhatsApp API Campaign Manager

## Prerequisites

Pastikan Anda sudah menginstall:
- Docker Desktop (Windows/Mac) atau Docker Engine + Docker Compose (Linux)
- Git (opsional, untuk clone repository)

## Quick Start (Development)

### 1. Clone atau Copy Project

```powershell
cd "d:\codecana Dev\cloude sonet"
```

### 2. Copy Environment Variables

```powershell
Copy-Item .env.example .env
```

Edit file `.env` sesuai kebutuhan Anda.

### 3. Build dan Jalankan dengan Docker Compose

```powershell
docker-compose up -d
```

Perintah ini akan:
- Download semua Docker images yang diperlukan
- Build backend dan frontend
- Start semua services (PostgreSQL, Redis, WAHA, Backend, Frontend, Nginx)

### 4. Tunggu hingga semua container running

```powershell
docker-compose ps
```

Pastikan semua services dalam status "Up".

### 5. Jalankan Database Migration

```powershell
docker exec -it whatsapp-backend npx prisma migrate deploy
docker exec -it whatsapp-backend npx prisma generate
```

### 6. Akses Aplikasi

- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:4000
- **WAHA Dashboard**: http://localhost:3000
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## Development Mode (tanpa Docker)

### Backend

```powershell
cd backend
npm install
npm run dev
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

## Production Deployment

### 1. Update Environment Variables

Edit `.env` untuk production:

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@postgres:5432/dbname
REDIS_URL=redis://redis:6379
WAHA_URL=http://waha:3000
```

### 2. Build dan Deploy

```powershell
docker-compose -f docker-compose.yml up -d --build
```

### 3. Setup SSL (Opsional dengan Let's Encrypt)

Edit `docker-compose.yml` untuk menambahkan certbot service.

## Commands Berguna

### Melihat Logs

```powershell
# All services
docker-compose logs -f

# Backend only
docker-compose logs -f backend

# Frontend only
docker-compose logs -f frontend
```

### Stop Services

```powershell
docker-compose down
```

### Restart Services

```powershell
docker-compose restart
```

### Remove All Data (HATI-HATI!)

```powershell
docker-compose down -v
```

### Access Database

```powershell
docker exec -it whatsapp-postgres psql -U whatsapp_user -d whatsapp_db
```

### Prisma Studio (Database GUI)

```powershell
docker exec -it whatsapp-backend npx prisma studio
```

Buka http://localhost:5555

## Troubleshooting

### Port sudah digunakan

Jika port 3001, 4000, 3000, 5432, atau 6379 sudah digunakan, edit file `docker-compose.yml` dan ubah port mapping.

### WAHA QR Code tidak muncul

Tunggu beberapa detik dan klik "Refresh" atau "Show QR" lagi. WAHA memerlukan waktu untuk generate QR code.

### Campaign tidak terkirim

1. Pastikan session status = "working" (sudah scan QR dan terkoneksi)
2. Pastikan ada kontak di database
3. Cek logs: `docker-compose logs -f backend`

### Database Migration Error

```powershell
docker exec -it whatsapp-backend npx prisma migrate reset
docker exec -it whatsapp-backend npx prisma migrate deploy
```

## CSV Format untuk Upload Contacts

Buat file CSV dengan format berikut:

```csv
name,phoneNumber,email
John Doe,628123456789,john@example.com
Jane Smith,628987654321,jane@example.com
```

**Catatan**:
- phoneNumber harus dengan format international tanpa tanda + (contoh: 628123456789)
- email opsional
- Header (name,phoneNumber,email) harus ada di baris pertama

## API Documentation

### Sessions

- `POST /api/sessions` - Create new session
- `GET /api/sessions` - Get all sessions
- `GET /api/sessions/:id` - Get session by ID
- `GET /api/sessions/:id/qr` - Get QR code
- `POST /api/sessions/:id/stop` - Stop session

### Contacts

- `POST /api/contacts/upload` - Upload CSV file
- `GET /api/contacts` - Get all contacts
- `POST /api/contacts` - Create contact manually
- `DELETE /api/contacts/:id` - Delete contact

### Campaigns

- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns` - Get all campaigns
- `GET /api/campaigns/:id` - Get campaign details
- `POST /api/campaigns/:id/send` - Send campaign
- `DELETE /api/campaigns/:id` - Delete campaign

## Support

Jika ada masalah, cek:
1. Docker logs: `docker-compose logs -f`
2. Container status: `docker-compose ps`
3. Database connection: `docker exec -it whatsapp-postgres psql -U whatsapp_user -d whatsapp_db`
