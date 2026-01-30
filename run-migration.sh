#!/bin/bash
# Script untuk menjalankan database migration
# Jalankan script ini dari folder project root

echo "🔄 Running database migration for anti-ban optimization..."

# Option 1: Jalankan di dalam backend container
docker-compose exec backend npx prisma migrate deploy

# Atau jika container belum running, build ulang
# docker-compose build backend
# docker-compose up -d

echo "✅ Migration completed!"
echo ""
echo "📝 Next steps:"
echo "1. Restart backend: docker-compose restart backend"
echo "2. Re-upload CSV kontak Anda"
echo "3. Test broadcast dengan template {{name}} atau {{nama}}"
