# Quick Start Commands

## Setup (First Time Only)
```powershell
.\setup.bat
```
Atau:
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

## User Management (Admin Only)

### Create First Admin User
```powershell
# Via API call (after backend is running)
curl -X POST http://localhost:4000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{
    \"email\": \"admin@example.com\",
    \"password\": \"admin123\",
    \"name\": \"Admin User\",
    \"role\": \"admin\"
  }'
```

### Create Regular User
```powershell
# Via API call (only admin or initial setup)
curl -X POST http://localhost:4000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{
    \"email\": \"user@example.com\",
    \"password\": \"password123\",
    \"name\": \"Regular User\",
    \"role\": \"user\"
  }'
```

### Login User (Get JWT Token)
```powershell
curl -X POST http://localhost:4000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{
    \"email\": \"admin@example.com\",
    \"password\": \"admin123\"
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clx...",
    "email": "admin@example.com",
    "name": "Admin User",
    "role": "admin"
  }
}
```

### Check Current User
```powershell
# Replace YOUR_TOKEN with the token from login response
curl -X GET http://localhost:4000/api/auth/me `
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Create User via Database (Alternative Method)
```powershell
# Access PostgreSQL
docker exec -it whatsapp-postgres psql -U whatsapp_user -d whatsapp_db

# Then run:
INSERT INTO users (id, email, password, name, role, "isActive", "createdAt", "updatedAt")
VALUES (
  'admin1',
  'admin@example.com',
  '$2a$10$abcdefghijklmnopqrstuvwxyz123456',  -- Use bcrypt hash for password
  'Admin User',
  'admin',
  true,
  NOW(),
  NOW()
);
```

**Note**: Password hashing:
```javascript
// You can generate bcrypt hash using Node.js:
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('your-password', 10);
console.log(hash);
```

## Daily Operations

### Start Application
```powershell
docker-compose up -d
```

### Stop Application
```powershell
docker-compose down
```

### View Logs (All Services)
```powershell
docker-compose logs -f
```

### View Logs (Specific Service)
```powershell
# Backend only
docker-compose logs -f backend

# Frontend only
docker-compose logs -f frontend

# WAHA only
docker-compose logs -f waha
```

### Restart Service
```powershell
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart backend
docker-compose restart frontend
docker-compose restart waha
```

### Database Commands
```powershell
# Run migration
docker exec whatsapp-backend npx prisma migrate deploy

# Open Prisma Studio (Database GUI)
docker exec whatsapp-backend npx prisma studio
# Then open: http://localhost:5555

# Backup database
docker exec whatsapp-postgres pg_dump -U whatsapp_user whatsapp_db > backup.sql

# Restore database
Get-Content backup.sql | docker exec -i whatsapp-postgres psql -U whatsapp_user -d whatsapp_db
```

### Check Container Status
```powershell
docker-compose ps
```

### Access Database Directly
```powershell
docker exec -it whatsapp-postgres psql -U whatsapp_user -d whatsapp_db
```

### Clean Up (Remove All Data)
```powershell
docker-compose down -v
```

### Update & Rebuild
```powershell
docker-compose down
docker-compose pull
docker-compose up -d --build
```

## NPM Scripts (Alternative)

```powershell
# Start
npm start

# Stop
npm run stop

# View logs
npm run logs

# Restart
npm run restart

# Database migration
npm run db:migrate

# Database backup
npm run db:backup
```

## Application URLs

- Frontend: http://localhost:3001
- Backend API: http://localhost:4000
- WAHA Dashboard: http://localhost:3000
- Prisma Studio: http://localhost:5555 (after running `npm run db:studio`)

## Troubleshooting

### If ports are in use
Edit `docker-compose.yml` and change the ports

### If containers won't start
```powershell
docker-compose down -v
docker-compose up -d --build
```

### If migration fails
```powershell
docker exec whatsapp-backend npx prisma migrate reset
docker exec whatsapp-backend npx prisma migrate deploy
```

### View resource usage
```powershell
docker stats
```
