FROM node:18-alpine

WORKDIR /app

# System deps for Prisma on Alpine (musl)
# - libc6-compat: glibc compatibility
# - openssl / openssl1.1-compat: SSL libs required by Prisma engines
RUN apk add --no-cache libc6-compat openssl || true \
	&& apk add --no-cache openssl1.1-compat || true

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
