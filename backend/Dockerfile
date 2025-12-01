FROM node:18-bullseye-slim

WORKDIR /app

# System deps for Prisma on Debian
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 4000

# Run migrations and start
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
