# 📦 Multi-Instance Setup Files

## File yang Dibuat

### 1. `docker-compose.template.yml`
Template docker-compose yang bisa digunakan untuk generate instance. Menggunakan environment variables untuk konfigurasi.

**Penggunaan:**
- Digunakan oleh script `setup-multi-instance.sh` untuk generate instances
- Bisa digunakan manual dengan environment variables

### 2. `setup-multi-instance.sh`
Script utama untuk generate semua 10 instances dengan konfigurasi lengkap.

**Fitur:**
- Generate 10 instance terpisah
- Generate docker-compose.yml per instance
- Generate .env file dengan secrets unik
- Generate startup/stop/restart scripts
- Generate management script untuk semua instances

**Cara Pakai:**
```bash
chmod +x setup-multi-instance.sh
./setup-multi-instance.sh
```

### 3. `generate-instances.sh`
Script alternatif yang lebih sederhana untuk generate docker-compose.yml saja.

**Cara Pakai:**
```bash
chmod +x generate-instances.sh
./generate-instances.sh
```

### 4. `docker-compose.multi.yml`
Contoh docker-compose.yml yang berisi 2 instances dalam 1 file (untuk referensi).

**Catatan:** File ini hanya contoh untuk instance 1 dan 2. Untuk production, gunakan script untuk generate instances terpisah.

### 5. `MULTI_INSTANCE_SETUP.md`
Dokumentasi lengkap cara setup dan manage multi-instance.

## Quick Start

### Step 1: Generate Instances

```bash
cd /opt/whatsapp-campaign
chmod +x setup-multi-instance.sh
./setup-multi-instance.sh
```

### Step 2: Update WAHA License

```bash
WAHA_LICENSE="your-actual-license-key"
for i in {1..10}; do
    sed -i "s/WAHA_LICENSE_KEY=.*/WAHA_LICENSE_KEY=$WAHA_LICENSE/" \
        /opt/whatsapp-instances/instance-$i/.env
done
```

### Step 3: Start Instances

```bash
cd /opt/whatsapp-instances
./manage-all.sh start
```

### Step 4: Verify

```bash
# Check status
./manage-all.sh status

# Test API
curl http://localhost:4000/health
curl http://localhost:4001/health
```

## Port Mapping

| Instance | PostgreSQL | Redis | WAHA  | Backend | Frontend | Domain             |
|----------|------------|-------|-------|---------|----------|-------------------|
| 1        | 5432       | 6379  | 3000  | 4000    | 3001     | app1.watrix.online|
| 2        | 5433       | 6380  | 3100  | 4001    | 3002     | app2.watrix.online|
| 3        | 5434       | 6381  | 3200  | 4002    | 3003     | app3.watrix.online|
| 4        | 5435       | 6382  | 3300  | 4003    | 3004     | app4.watrix.online|
| 5        | 5436       | 6383  | 3400  | 4004    | 3005     | app5.watrix.online|
| 6        | 5437       | 6384  | 3500  | 4005    | 3006     | app6.watrix.online|
| 7        | 5438       | 6385  | 3600  | 4006    | 3007     | app7.watrix.online|
| 8        | 5439       | 6386  | 3700  | 4007    | 3008     | app8.watrix.online|
| 9        | 5440       | 6387  | 3800  | 4008    | 3009     | app9.watrix.online|
| 10       | 5441       | 6388  | 3900  | 4009    | 3010     | app10.watrix.online|

## Management Commands

### All Instances

```bash
cd /opt/whatsapp-instances

# Start all
./manage-all.sh start

# Stop all
./manage-all.sh stop

# Restart all
./manage-all.sh restart

# Status all
./manage-all.sh status
```

### Single Instance

```bash
cd /opt/whatsapp-instances

# Start instance 1
./manage-all.sh start 1

# Stop instance 5
./manage-all.sh stop 5

# Restart instance 3
./manage-all.sh restart 3
```

## Directory Structure

Setelah generate, struktur direktori akan seperti ini:

```
/opt/whatsapp-instances/
├── instance-1/
│   ├── docker-compose.yml
│   ├── .env
│   ├── start.sh
│   ├── stop.sh
│   ├── restart.sh
│   ├── backend/
│   ├── frontend/
│   └── ...
├── instance-2/
│   ├── docker-compose.yml
│   ├── .env
│   └── ...
├── ...
├── instance-10/
│   └── ...
└── manage-all.sh
```

## Important Notes

1. **Isolasi Penuh:** Setiap instance memiliki database, WAHA, backend, frontend, dan Redis sendiri
2. **Port Unik:** Setiap instance menggunakan port yang berbeda untuk menghindari konflik
3. **Secrets Unik:** Setiap instance memiliki JWT_SECRET dan WAHA_API_KEY yang berbeda
4. **Domain:** Setiap instance menggunakan domain berbeda (app1.watrix.online, app2.watrix.online, dst)
5. **Resource:** Pastikan VPS memiliki resource cukup (16-32GB RAM untuk 10 instances)

## Troubleshooting

Lihat dokumentasi lengkap di `MULTI_INSTANCE_SETUP.md` untuk troubleshooting dan best practices.

---

**Selamat Setup! 🚀**
