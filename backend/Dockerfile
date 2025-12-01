FROM node:18-bullseye-slim

WORKDIR /app

# Install OpenSSL 3.x and other dependencies for Prisma
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    openssl \
    libssl3 \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client with explicit binary target
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 4000

# Run migrations and start
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
