# Panduan Lengkap - WhatsApp Campaign Manager

## 📋 Daftar Isi

1. [Instalasi](#instalasi)
2. [Konfigurasi](#konfigurasi)
3. [Menjalankan Aplikasi](#menjalankan-aplikasi)
4. [Cara Penggunaan](#cara-penggunaan)
5. [Multi-Instance Setup](#multi-instance-setup)
6. [Troubleshooting](#troubleshooting)

## 🚀 Instalasi

### Windows

1. Install Docker Desktop dari https://www.docker.com/products/docker-desktop/

2. Buka PowerShell di folder project:
```powershell
cd "d:\codecana Dev\cloude sonet"
```

3. Jalankan setup script:
```powershell
.\setup.bat
```

### Linux/Mac

1. Install Docker dan Docker Compose

2. Buka terminal di folder project:
```bash
cd "/path/to/project"
```

3. Jalankan setup script:
```bash
chmod +x setup.sh
./setup.sh
```

## ⚙️ Konfigurasi

Edit file `.env` sesuai kebutuhan:

```env
# Database
DATABASE_URL=postgresql://whatsapp_user:whatsapp_pass@localhost:5432/whatsapp_db
POSTGRES_USER=whatsapp_user
POSTGRES_PASSWORD=whatsapp_pass
POSTGRES_DB=whatsapp_db

# Redis
REDIS_URL=redis://localhost:6379

# WAHA (WhatsApp HTTP API)
WAHA_URL=http://localhost:3000

# Backend
BACKEND_PORT=4000
NODE_ENV=development

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
FRONTEND_PORT=3001
```

## 🏃 Menjalankan Aplikasi

### Menggunakan Docker (Recommended)

```powershell
# Start semua services
docker-compose up -d

# Lihat logs
docker-compose logs -f

# Stop semua services
docker-compose down

# Restart service tertentu
docker-compose restart backend
```

### Development Mode (Tanpa Docker)

#### Backend
```powershell
cd backend
npm install
npm run dev
```

#### Frontend
```powershell
cd frontend
npm install
npm run dev
```

## 📱 Cara Penggunaan

### 1. Buat Session WhatsApp

1. Buka http://localhost:3001
2. Klik menu **Sessions**
3. Klik tombol **Create Session**
4. Klik **Show QR** untuk menampilkan QR code
5. Scan QR code dengan WhatsApp di HP Anda:
   - Buka WhatsApp di HP
   - Tap titik tiga di kanan atas
   - Pilih **Linked Devices**
   - Tap **Link a Device**
   - Scan QR code yang muncul di web

6. Tunggu hingga status berubah menjadi **working**
7. Klik **Refresh** (ikon refresh) untuk update status

### 2. Upload Kontak

1. Klik menu **Contacts**
2. Buat file CSV dengan format:
   ```csv
   name,phoneNumber,email
   John Doe,628123456789,john@example.com
   Jane Smith,628987654321,jane@example.com
   ```
   
   **Penting:**
   - phoneNumber harus format international tanpa tanda + (contoh: 628123456789 untuk +62 812-3456-789)
   - Header harus persis: `name,phoneNumber,email`
   - Email bersifat opsional

3. Drag & drop file CSV atau klik untuk upload
4. Lihat kontak yang berhasil di-import di tabel

**Contoh File:** Gunakan `sample-contacts.csv` yang sudah tersedia di project

### 3. Buat Campaign

1. Klik menu **Campaigns**
2. Klik **Create Campaign**
3. Isi form:
   - **Campaign Name**: Nama campaign (contoh: "Promo Ramadan 2024")
   - **Session**: Pilih session yang sudah **working**
   - **Message**: Tulis pesan Anda (support multi-line)
   - **Image URL**: URL gambar (opsional, contoh: https://example.com/promo.jpg)
   - **Button 1 Label**: Label tombol pertama (contoh: "Lihat Promo")
   - **Button 1 URL**: URL untuk tombol pertama (contoh: https://tokosaya.com/promo)
   - **Button 2 Label**: Label tombol kedua (opsional)
   - **Button 2 URL**: URL untuk tombol kedua (opsional)

4. Klik **Create Campaign**

**Contoh Campaign:**
```
Campaign Name: Flash Sale 50%
Message: 
Halo! 🎉

Kami punya kabar gembira untuk Anda!
Flash Sale 50% untuk semua produk hari ini!

Buruan klik tombol di bawah sebelum kehabisan!

Button 1: Belanja Sekarang → https://tokosaya.com/sale
Button 2: Lihat Katalog → https://tokosaya.com/catalog
```

### 4. Kirim Campaign

1. Di halaman **Campaigns**, cari campaign yang statusnya **draft**
2. Klik tombol **Send Campaign**
3. Konfirmasi pengiriman
4. Campaign akan dikirim ke semua kontak secara otomatis menggunakan queue system
5. Monitor progress di angka **Sent** dan **Failed**

### 5. Monitor Pengiriman

1. Klik menu **Messages**
2. Lihat status setiap pesan:
   - 🟡 **pending**: Dalam antrian
   - 🟢 **sent**: Terkirim ke WhatsApp
   - 🔵 **delivered**: Sampai ke penerima
   - 🔴 **failed**: Gagal kirim (lihat kolom Error untuk detail)

3. Halaman ini auto-refresh setiap 10 detik

## 🏢 Multi-Instance Setup (10 Web dalam 1 VPS)

### Metode 1: Port-Based (Paling Simple)

Buat 10 folder instance:

```powershell
mkdir instance-1, instance-2, instance-3, instance-4, instance-5, instance-6, instance-7, instance-8, instance-9, instance-10
```

Copy project ke setiap folder dan edit `.env`:

**Instance 1:**
```env
FRONTEND_PORT=3001
BACKEND_PORT=4001
WAHA_PORT=3000
POSTGRES_PORT=5432
REDIS_PORT=6379
```

**Instance 2:**
```env
FRONTEND_PORT=3002
BACKEND_PORT=4002
WAHA_PORT=3100
POSTGRES_PORT=5433
REDIS_PORT=6380
```

Dan seterusnya...

Jalankan di setiap folder:
```powershell
docker-compose up -d
```

### Metode 2: Subdomain-Based (Recommended untuk Production)

Setup nginx config:

```nginx
# Instance 1
server {
    listen 80;
    server_name wa1.yourdomain.com;
    location / {
        proxy_pass http://localhost:3001;
    }
}

# Instance 2
server {
    listen 80;
    server_name wa2.yourdomain.com;
    location / {
        proxy_pass http://localhost:3002;
    }
}
# ... dst sampai instance 10
```

Gunakan Let's Encrypt untuk SSL:
```bash
sudo certbot --nginx -d wa1.yourdomain.com -d wa2.yourdomain.com
```

### Resource Requirements untuk 10 Instance

**Minimum VPS Specs:**
- CPU: 8 cores
- RAM: 16GB
- Storage: 100GB SSD
- Bandwidth: 1TB/month

**Recommended VPS:**
- CPU: 16 cores
- RAM: 32GB
- Storage: 200GB SSD
- Bandwidth: Unlimited

## 🔧 Troubleshooting

### QR Code Tidak Muncul

**Solusi:**
1. Tunggu 10-15 detik
2. Klik tombol **Show QR** lagi
3. Cek logs: `docker-compose logs -f waha`
4. Restart WAHA: `docker-compose restart waha`

### Campaign Tidak Terkirim

**Checklist:**
1. ✅ Session status = **working** (sudah scan QR dan connected)
2. ✅ Ada kontak di database
3. ✅ Campaign sudah dibuat dan diklik **Send Campaign**
4. ✅ Cek logs backend: `docker-compose logs -f backend`
5. ✅ Cek Redis: `docker-compose logs -f redis`

### Port Already in Use

Edit `docker-compose.yml` dan ubah port:

```yaml
ports:
  - "3002:3001"  # Ganti 3001 jadi 3002
```

### Database Connection Error

```powershell
# Reset database
docker-compose down -v
docker-compose up -d
docker exec -it whatsapp-backend npx prisma migrate deploy
```

### WhatsApp Disconnected

1. Cek di HP apakah masih connected
2. Restart session dari dashboard
3. Scan QR code lagi jika perlu

### Pesan Stuck di Pending

1. Cek Redis: `docker-compose logs -f redis`
2. Restart backend: `docker-compose restart backend`
3. Cek apakah session masih **working**

### Memory Issues

Jika RAM penuh:

```powershell
# Stop unused containers
docker-compose down

# Prune unused data
docker system prune -a

# Restart with resource limits
docker-compose up -d
```

## 📞 Tips & Best Practices

### 1. Pengiriman Pesan

- **Jangan spam**: Tunggu 2-3 detik antar pesan (sudah diatur otomatis di queue)
- **Batasi jumlah**: Max 1000 pesan/hari per session untuk avoid ban
- **Gunakan template**: Buat template pesan yang personal

### 2. Maintenance

```powershell
# Backup database setiap hari
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db > backup_$(Get-Date -Format "yyyyMMdd").sql

# Clean logs
docker-compose logs --tail=100 > logs.txt

# Update images
docker-compose pull
docker-compose up -d
```

### 3. Monitoring

- Setup monitoring dengan Grafana/Prometheus
- Track success rate pengiriman
- Monitor CPU/RAM usage
- Setup alerts untuk session disconnect

### 4. Security

- Ganti password default di `.env`
- Setup firewall
- Gunakan SSL/HTTPS di production
- Backup data secara rutin

## 🆘 Support

Jika masih ada masalah:

1. Cek logs: `docker-compose logs -f`
2. Lihat status containers: `docker-compose ps`
3. Restart semua: `docker-compose restart`
4. Baca dokumentasi WAHA: https://waha.devlike.pro

## 📝 License

MIT License - Free to use untuk personal dan commercial projects.
