# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Install ALL dependencies (including devDependencies for tsc)
RUN npm ci

COPY . .

# Build TypeScript code
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Install only production dependencies
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081

CMD ["node", "dist/index.js"]
