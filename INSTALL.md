# 🚀 Quick Installation Guide

## Langkah 1: Persiapan

### Install Docker Desktop
- **Windows**: Download dari https://www.docker.com/products/docker-desktop/
- **Mac**: Download dari https://www.docker.com/products/docker-desktop/
- **Linux**: 
  ```bash
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  ```

### Verifikasi Docker
```powershell
docker --version
docker-compose --version
```

## Langkah 2: Setup Project

### Windows (PowerShell)
```powershell
# Navigate ke folder project
cd "d:\codecana Dev\cloude sonet"

# Jalankan setup
.\setup.bat

# Atau dengan PowerShell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### Linux/Mac
```bash
# Navigate ke folder project
cd "/path/to/cloude sonet"

# Make script executable
chmod +x setup.sh

# Jalankan setup
./setup.sh
```

## Langkah 3: Tunggu Setup Selesai

Setup script akan otomatis:
1. ✅ Copy file .env dari .env.example
2. ✅ Build Docker images (Backend, Frontend)
3. ✅ Download images (PostgreSQL, Redis, WAHA, Nginx)
4. ✅ Start semua containers
5. ✅ Wait for PostgreSQL ready
6. ✅ Run database migrations
7. ✅ Generate Prisma client

**Waktu estimasi**: 5-10 menit (tergantung internet)

## Langkah 4: Verifikasi

### Cek Status Containers
```powershell
docker-compose ps
```

Semua services harus status "Up":
```
whatsapp-backend    Up
whatsapp-frontend   Up
whatsapp-postgres   Up
whatsapp-redis      Up
whatsapp-waha       Up
whatsapp-nginx      Up
```

### Cek Logs
```powershell
docker-compose logs -f
```

### Akses Aplikasi
- ✅ Frontend: http://localhost:3001
- ✅ Backend: http://localhost:4000/health
- ✅ WAHA: http://localhost:3000

## Langkah 5: First Use

### 1. Buat Session
1. Buka http://localhost:3001
2. Klik menu **"Sessions"**
3. Klik tombol **"Create Session"**
4. Tunggu beberapa detik
5. Klik **"Show QR"**
6. Scan QR code dengan WhatsApp di HP:
   - Buka WhatsApp → Menu (⋮) → Linked Devices
   - Tap "Link a Device"
   - Scan QR code di layar

### 2. Upload Kontak
1. Klik menu **"Contacts"**
2. Gunakan file `sample-contacts.csv` atau buat sendiri:
   ```csv
   name,phoneNumber,email
   John Doe,628123456789,john@example.com
   ```
3. Drag & drop file CSV atau klik untuk upload
4. Lihat kontak muncul di tabel

### 3. Buat Campaign
1. Klik menu **"Campaigns"**
2. Klik **"Create Campaign"**
3. Isi form:
   - **Name**: Flash Sale 50%
   - **Session**: Pilih session yang status "working"
   - **Message**: Tulis pesan Anda
   - **Image URL**: (Opsional) https://example.com/image.jpg
   - **Button 1**: Label "Belanja" URL "https://tokosaya.com"
   - **Button 2**: (Opsional)
4. Klik **"Create Campaign"**

### 4. Kirim Campaign
1. Di list campaigns, cari campaign Anda
2. Klik **"Send Campaign"**
3. Konfirmasi
4. Monitor di menu **"Messages"**

## ⚠️ Troubleshooting

### Port Sudah Digunakan
```powershell
# Stop services lain yang pakai port 3001, 4000, 3000, 5432, 6379
# Atau edit docker-compose.yml untuk ganti port
```

### QR Code Tidak Muncul
```powershell
# Tunggu 10-15 detik
# Klik "Show QR" lagi
# Atau restart WAHA
docker-compose restart waha
```

### Database Error
```powershell
# Reset database
docker-compose down -v
docker-compose up -d
# Tunggu 15 detik
docker exec whatsapp-backend npx prisma migrate deploy
```

### Container Tidak Start
```powershell
# Lihat logs
docker-compose logs -f

# Restart semua
docker-compose restart

# Atau rebuild
docker-compose down
docker-compose up -d --build
```

## 📋 Daily Operations

### Start Aplikasi
```powershell
docker-compose up -d
```

### Stop Aplikasi
```powershell
docker-compose down
```

### View Logs
```powershell
docker-compose logs -f
```

### Restart
```powershell
docker-compose restart
```

### Backup Database
```powershell
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db > backup_$(Get-Date -Format "yyyyMMdd").sql
```

## 📚 Next Steps

Setelah berhasil install:

1. ✅ Baca **PANDUAN.md** untuk panduan lengkap
2. ✅ Lihat **COMMANDS.md** untuk command reference
3. ✅ Cek **FAQ.md** jika ada masalah
4. ✅ Review **API.md** untuk API documentation

## 🎉 Selamat!

Anda sudah berhasil menginstall **WhatsApp Campaign Manager**!

Jika ada pertanyaan atau masalah, cek:
- FAQ.md - Pertanyaan umum
- Logs: `docker-compose logs -f`
- Status: `docker-compose ps`

---

**Support**: Baca dokumentasi di folder project atau create issue di repository.

**License**: MIT - Free to use untuk personal dan commercial.
