# Project Structure

```
whatsapp-campaign-manager/
│
├── backend/                          # Express.js Backend
│   ├── src/
│   │   ├── routes/                   # API Routes
│   │   │   ├── session.routes.ts     # Session management endpoints
│   │   │   ├── contact.routes.ts     # Contact management endpoints
│   │   │   ├── campaign.routes.ts    # Campaign management endpoints
│   │   │   └── webhook.routes.ts     # WAHA webhook handlers
│   │   │
│   │   ├── services/                 # Business Logic
│   │   │   ├── waha.service.ts       # WAHA API integration
│   │   │   └── queue.service.ts      # Bull queue for messages
│   │   │
│   │   ├── middleware/               # Express Middleware
│   │   │   └── errorHandler.ts       # Global error handler
│   │   │
│   │   ├── lib/                      # Utilities
│   │   │   └── prisma.ts             # Prisma client instance
│   │   │
│   │   └── index.ts                  # Express app entry point
│   │
│   ├── prisma/                       # Database
│   │   ├── schema.prisma             # Database schema
│   │   └── migrations/               # Migration files
│   │       └── 20231201000000_init/
│   │           └── migration.sql     # Initial migration
│   │
│   ├── Dockerfile                    # Backend Docker image
│   ├── .dockerignore
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                         # Next.js Frontend
│   ├── src/
│   │   ├── app/                      # Next.js 14 App Router
│   │   │   ├── page.tsx              # Dashboard homepage
│   │   │   ├── layout.tsx            # Root layout
│   │   │   ├── globals.css           # Global styles
│   │   │   │
│   │   │   ├── sessions/             # Session pages
│   │   │   │   └── page.tsx          # Sessions list & QR scanner
│   │   │   │
│   │   │   ├── contacts/             # Contact pages
│   │   │   │   └── page.tsx          # Contacts list & upload
│   │   │   │
│   │   │   ├── campaigns/            # Campaign pages
│   │   │   │   └── page.tsx          # Campaigns list & creator
│   │   │   │
│   │   │   └── messages/             # Message pages
│   │   │       └── page.tsx          # Messages monitor
│   │   │
│   │   └── lib/                      # Utilities
│   │       └── api.ts                # Axios API client
│   │
│   ├── public/                       # Static files
│   ├── Dockerfile                    # Frontend Docker image
│   ├── .dockerignore
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── package.json
│   └── tsconfig.json
│
├── nginx/                            # Nginx Reverse Proxy
│   ├── nginx.conf                    # Main nginx configuration
│   └── sites/                        # Site configs (for multi-instance)
│
├── docs/                             # Documentation (optional)
│
├── .env                              # Environment variables (production)
├── .env.example                      # Environment template
├── .gitignore                        # Git ignore rules
│
├── docker-compose.yml                # Docker orchestration
│
├── package.json                      # Root package.json (scripts)
│
├── setup.sh                          # Linux/Mac setup script
├── setup.bat                         # Windows batch setup script
├── setup.ps1                         # PowerShell setup script
│
├── sample-contacts.csv               # Sample CSV for testing
│
├── README.md                         # Project overview
├── PANDUAN.md                        # Indonesian guide
├── SETUP.md                          # Setup instructions
├── API.md                            # API documentation
├── FAQ.md                            # FAQ
├── DEPLOYMENT.md                     # Multi-instance deployment
├── COMMANDS.md                       # Quick commands reference
├── CHANGELOG.md                      # Version history
├── CONTRIBUTING.md                   # Contribution guidelines
└── LICENSE                           # MIT License

```

## Key Directories Explained

### `/backend`
Backend API built with Express.js and TypeScript.

- **`/routes`**: HTTP endpoint definitions
- **`/services`**: Business logic and external API integrations
- **`/middleware`**: Express middleware (auth, error handling, etc.)
- **`/lib`**: Shared utilities and helpers
- **`/prisma`**: Database schema and migrations

### `/frontend`
Frontend application built with Next.js 14 App Router.

- **`/app`**: Next.js pages using App Router structure
- **`/lib`**: Frontend utilities (API client, helpers)
- **`/components`**: Reusable React components (if any)

### `/nginx`
Nginx configuration for reverse proxy and multi-instance support.

### Root Files

- **`docker-compose.yml`**: Defines all services (Frontend, Backend, PostgreSQL, Redis, WAHA, Nginx)
- **`.env`**: Environment variables for production
- **`.env.example`**: Template for environment variables
- **Setup scripts**: Automated setup for different platforms
- **Documentation files**: Various MD files for different purposes

## Service Architecture

```
┌─────────────────┐
│   Nginx:80      │  ← Entry point
└────────┬────────┘
         │
    ┌────┴─────┬──────────┐
    │          │          │
┌───▼───┐  ┌───▼───┐  ┌───▼────┐
│ Front │  │  API  │  │ WAHA   │
│ :3001 │  │ :4000 │  │ :3000  │
└───┬───┘  └───┬───┘  └────────┘
    │          │
    │      ┌───▼────┐
    │      │ Redis  │
    │      │ :6379  │
    │      └────────┘
    │          │
    │      ┌───▼────────┐
    └──────┤ PostgreSQL │
           │   :5432    │
           └────────────┘
```

## Database Schema

```prisma
Session (WhatsApp sessions)
├── id: String (PK)
├── name: String
├── sessionId: String (Unique)
├── status: String
├── qrCode: String?
├── phoneNumber: String?
└── campaigns: Campaign[]

Contact (Contact list)
├── id: String (PK)
├── name: String
├── phoneNumber: String (Unique)
├── email: String?
├── tags: String[]
└── messages: Message[]

Campaign (Marketing campaigns)
├── id: String (PK)
├── name: String
├── message: Text
├── imageUrl: String?
├── status: String
├── sessionId: String (FK → Session)
├── totalContacts: Int
├── sentCount: Int
├── failedCount: Int
├── buttons: Button[]
└── messages: Message[]

Button (Campaign buttons)
├── id: String (PK)
├── campaignId: String (FK → Campaign)
├── label: String
├── url: String
└── order: Int

Message (Message queue/history)
├── id: String (PK)
├── campaignId: String (FK → Campaign)
├── contactId: String (FK → Contact)
├── status: String
├── waMessageId: String?
├── errorMsg: String?
├── sentAt: DateTime?
└── deliveredAt: DateTime?
```

## API Flow

1. **Session Creation**: User → Frontend → Backend → WAHA → Database
2. **QR Scanning**: Frontend polls Backend → Backend queries WAHA → Returns QR
3. **Contact Upload**: CSV → Frontend → Backend → Parse → Database
4. **Campaign Create**: Form → Frontend → Backend → Database (with buttons)
5. **Campaign Send**: Button → Backend → Create messages → Queue in Redis
6. **Message Processing**: Queue worker → WAHA API → Update status → Database
7. **Webhook**: WAHA → Backend webhook → Update message status → Database

## Tech Stack Details

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Frontend Framework | Next.js | 14 | React framework with App Router |
| UI Styling | TailwindCSS | 3.4 | Utility-first CSS |
| Backend Framework | Express.js | 4.18 | Web application framework |
| Language | TypeScript | 5.3 | Type-safe JavaScript |
| ORM | Prisma | 5.7 | Database toolkit |
| Database | PostgreSQL | 15 | Relational database |
| Cache/Queue | Redis | 7 | In-memory data store |
| Queue Library | Bull | 4.12 | Redis-based queue |
| WhatsApp API | WAHA | Latest | WhatsApp HTTP API |
| Reverse Proxy | Nginx | Alpine | Web server & proxy |
| Containerization | Docker | Latest | Container platform |

## Development Workflow

1. **Local Development**: Run services via `npm run dev` or Docker
2. **Code Changes**: Edit TypeScript files
3. **Hot Reload**: Next.js and tsx watch for changes
4. **Database Changes**: Create Prisma migration
5. **Testing**: Manual testing via frontend
6. **Commit**: Git commit with meaningful message
7. **Deploy**: `docker-compose up -d --build`

## Production Considerations

- Use environment-specific `.env` files
- Enable HTTPS with SSL certificates
- Setup database backups
- Configure monitoring and logging
- Implement rate limiting
- Add authentication/authorization
- Use production-grade Redis cluster
- Setup load balancer for multiple instances
