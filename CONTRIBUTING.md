# Contributing to WhatsApp Campaign Manager

First off, thank you for considering contributing to WhatsApp Campaign Manager! It's people like you that make this tool better for everyone.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps which reproduce the problem**
* **Provide specific examples to demonstrate the steps**
* **Describe the behavior you observed after following the steps**
* **Explain which behavior you expected to see instead and why**
* **Include screenshots and animated GIFs if possible**
* **Include logs** from `docker-compose logs -f`

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a step-by-step description of the suggested enhancement**
* **Provide specific examples to demonstrate the steps**
* **Describe the current behavior and expected behavior**
* **Explain why this enhancement would be useful**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Development Process

### Setup Development Environment

```powershell
# Clone your fork
git clone https://github.com/your-username/whatsapp-campaign-manager.git
cd whatsapp-campaign-manager

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Setup environment
cp .env.example .env

# Start development
docker-compose up -d
```

### Backend Development

```powershell
cd backend

# Start dev server
npm run dev

# Run database migrations
npx prisma migrate dev

# Open Prisma Studio
npx prisma studio

# Format code
npm run format

# Lint
npm run lint
```

### Frontend Development

```powershell
cd frontend

# Start dev server
npm run dev

# Build
npm run build

# Lint
npm run lint
```

### Coding Standards

#### TypeScript

* Use TypeScript for all new code
* Define proper types/interfaces
* Avoid using `any`
* Use meaningful variable and function names

#### React/Next.js

* Use functional components with hooks
* Keep components small and focused
* Use client components ('use client') only when necessary
* Follow React best practices

#### API Design

* Follow RESTful principles
* Use proper HTTP status codes
* Return consistent response format
* Document all endpoints in API.md

#### Database

* Use Prisma migrations for schema changes
* Write migration scripts carefully
* Test migrations on development first
* Document schema changes

### Commit Messages

* Use clear and meaningful commit messages
* Start with a verb (Add, Fix, Update, Remove, etc.)
* Keep the first line under 50 characters
* Add detailed description if needed

Examples:
```
Add CSV validation for contact upload
Fix QR code not displaying on Safari
Update campaign status tracking logic
Remove unused dependencies
```

### Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── middleware/      # Express middleware
│   │   └── lib/             # Utilities
│   ├── prisma/              # Database schema
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/             # Next.js pages
│   │   └── lib/             # Utilities
│   └── package.json
├── nginx/                    # Nginx config
├── docker-compose.yml
└── docs/
```

### Testing

Currently, we don't have automated tests. Contributions to add tests are highly welcome!

#### Manual Testing Checklist

- [ ] Session creation and QR scanning
- [ ] CSV upload with valid and invalid data
- [ ] Campaign creation with all field combinations
- [ ] Campaign sending to single and multiple contacts
- [ ] Message status updates
- [ ] Error handling

### Documentation

* Update README.md if you change functionality
* Update API.md if you change API endpoints
* Update PANDUAN.md for user-facing changes
* Add comments for complex logic
* Update CHANGELOG.md

## Questions?

Feel free to create an issue with the label `question`.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
