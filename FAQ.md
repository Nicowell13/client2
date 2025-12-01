# Frequently Asked Questions (FAQ)

## General

### Q: Apa itu WhatsApp Campaign Manager?
**A:** Sistem untuk mengelola dan mengirim campaign WhatsApp secara otomatis menggunakan WAHA (WhatsApp HTTP API). Anda dapat upload kontak, buat campaign dengan gambar dan button, lalu kirim ke banyak kontak sekaligus.

### Q: Apakah gratis?
**A:** Ya, aplikasi ini open source dan gratis. WAHA juga gratis untuk versi dasar dengan batasan 1000 pesan/hari per session.

### Q: Apakah legal menggunakan ini?
**A:** Pastikan Anda mengikuti Terms of Service WhatsApp. Jangan spam atau kirim pesan yang tidak diinginkan. Gunakan hanya untuk kontak yang sudah memberikan izin.

## Installation & Setup

### Q: OS apa yang didukung?
**A:** Windows, Mac, dan Linux. Yang penting ada Docker.

### Q: Berapa requirement minimum VPS/Server?
**A:** 
- 1 instance: 2 CPU cores, 4GB RAM, 20GB storage
- 10 instance: 8 CPU cores, 16GB RAM, 100GB storage

### Q: Apakah bisa di shared hosting?
**A:** Tidak, harus VPS atau dedicated server yang support Docker.

### Q: Error "Port already in use"
**A:** Edit `docker-compose.yml` dan ganti port yang conflict. Misalnya 3001 jadi 3002.

## WhatsApp Session

### Q: QR Code tidak muncul
**A:** 
1. Tunggu 10-15 detik setelah create session
2. Klik "Show QR" lagi
3. Restart WAHA: `docker-compose restart waha`
4. Cek logs: `docker-compose logs -f waha`

### Q: Session disconnect terus
**A:** 
1. Pastikan HP online dan WhatsApp berjalan
2. Jangan logout dari Linked Devices di HP
3. Scan QR lagi jika perlu
4. Cek koneksi internet server

### Q: Berapa lama QR code valid?
**A:** Sekitar 60 detik. Jika expire, request QR code baru.

### Q: Bisa pakai 1 nomor WhatsApp untuk multiple session?
**A:** Tidak. 1 nomor WhatsApp = 1 session.

### Q: Maksimal berapa session per nomor WhatsApp?
**A:** WhatsApp membatasi maksimal 5 linked devices per nomor.

## Contacts

### Q: Format nomor telepon yang benar?
**A:** International format tanpa tanda +
- ✅ Benar: 628123456789
- ❌ Salah: +62 812-3456-789
- ❌ Salah: 0812-3456-789

### Q: Format CSV yang benar?
**A:** 
```csv
name,phoneNumber,email
John Doe,628123456789,john@example.com
```
Header harus persis seperti itu.

### Q: Maksimal berapa kontak?
**A:** Tidak ada limit di aplikasi, tapi database dan RAM server jadi pertimbangan.

### Q: Upload CSV error
**A:**
1. Pastikan format CSV benar
2. Cek encoding file (harus UTF-8)
3. Pastikan tidak ada karakter special di nama
4. Cek kolom header harus lowercase

## Campaigns

### Q: Berapa maksimal pesan per hari?
**A:** WAHA gratis limit 1000 pesan/hari per session.

### Q: Apakah bisa kirim gambar?
**A:** Ya, gunakan URL gambar yang publicly accessible.

### Q: Maksimal berapa button?
**A:** 2 button per campaign (limitasi WAHA gratis).

### Q: Button tidak muncul di WhatsApp
**A:** Pada WAHA gratis, button muncul sebagai text dengan URL. Bukan interactive button seperti WhatsApp Business API berbayar.

### Q: Campaign stuck di "sending"
**A:**
1. Cek session masih "working"
2. Restart backend: `docker-compose restart backend`
3. Cek Redis: `docker-compose logs -f redis`
4. Cek queue: Monitor di logs

### Q: Banyak pesan failed
**A:**
1. Cek nomor format benar (628xxx)
2. Pastikan nomor aktif dan terdaftar WhatsApp
3. Jangan kirim terlalu cepat (system sudah auto delay)
4. Session mungkin disconnect

## Performance

### Q: Berapa kecepatan kirim pesan?
**A:** Sekitar 1 pesan per 2-3 detik untuk avoid ban dari WhatsApp.

### Q: Bisa kirim lebih cepat?
**A:** Bisa edit delay di `queue.service.ts` tapi risiko banned WhatsApp.

### Q: Database penuh
**A:**
```powershell
# Backup dulu
npm run db:backup

# Delete old messages
docker exec whatsapp-postgres psql -U whatsapp_user -d whatsapp_db -c "DELETE FROM messages WHERE created_at < NOW() - INTERVAL '30 days';"
```

### Q: RAM habis
**A:**
1. Restart containers: `docker-compose restart`
2. Clean unused data: `docker system prune`
3. Upgrade RAM server
4. Kurangi jumlah instance

## Multi-Instance

### Q: Cara setup 10 instance?
**A:** Lihat DEPLOYMENT.md untuk panduan lengkap.

### Q: Apakah perlu 10 nomor WhatsApp?
**A:** Ya, setiap instance perlu 1 nomor WhatsApp tersendiri.

### Q: Apakah bisa share database?
**A:** Bisa, tapi tidak recommended. Lebih baik setiap instance punya database sendiri.

### Q: Setup subdomain untuk setiap instance
**A:** 
```nginx
server {
    server_name wa1.domain.com;
    location / { proxy_pass http://localhost:3001; }
}
server {
    server_name wa2.domain.com;
    location / { proxy_pass http://localhost:3002; }
}
```

## Troubleshooting

### Q: Container tidak mau start
**A:**
```powershell
docker-compose down -v
docker-compose up -d --build
```

### Q: Migration error
**A:**
```powershell
docker exec whatsapp-backend npx prisma migrate reset
docker exec whatsapp-backend npx prisma migrate deploy
```

### Q: WAHA error "Session not found"
**A:** Create session baru dari dashboard.

### Q: Frontend tidak bisa connect ke Backend
**A:** 
1. Cek backend running: `docker-compose ps`
2. Cek URL di `.env`: `NEXT_PUBLIC_API_URL`
3. Restart frontend: `docker-compose restart frontend`

### Q: Cara lihat logs detail?
**A:**
```powershell
# All logs
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f waha
```

## Security

### Q: Apakah aman?
**A:** Untuk production:
1. Ganti password database di `.env`
2. Setup SSL/HTTPS
3. Setup firewall
4. Jangan expose port database ke public
5. Regular backup

### Q: Cara backup data?
**A:**
```powershell
# Manual backup
npm run db:backup

# Auto backup (cron job)
# Windows Task Scheduler atau Linux cron
0 2 * * * cd /path/to/project && npm run db:backup
```

### Q: Cara restore backup?
**A:**
```powershell
Get-Content backup.sql | docker exec -i whatsapp-postgres psql -U whatsapp_user -d whatsapp_db
```

## Advanced

### Q: Cara custom delay antar pesan?
**A:** Edit `backend/src/services/queue.service.ts`:
```typescript
backoff: {
  type: 'exponential',
  delay: 3000, // Ubah nilai ini (dalam ms)
}
```

### Q: Cara monitoring sistem?
**A:** Install Grafana + Prometheus atau gunakan tools seperti:
- Portainer untuk Docker management
- pgAdmin untuk PostgreSQL
- Redis Commander untuk Redis

### Q: Cara scale horizontal?
**A:** 
1. Setup load balancer (nginx)
2. Multiple backend instances share database
3. Redis cluster untuk queue
4. Separate WAHA per instance

### Q: Integrasi dengan aplikasi lain?
**A:** Gunakan REST API (lihat API.md). Bisa integrate dengan:
- CRM systems
- E-commerce platforms
- Webhook dari aplikasi lain

## Support & Community

### Q: Dimana bisa minta bantuan?
**A:** 
1. Baca dokumentasi lengkap (README.md, PANDUAN.md)
2. Cek logs untuk error message
3. WAHA documentation: https://waha.devlike.pro

### Q: Cara kontribusi ke project?
**A:** Fork repo, buat feature, submit pull request.

### Q: Boleh pakai untuk komersial?
**A:** Ya, project ini MIT License.
