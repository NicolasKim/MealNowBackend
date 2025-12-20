FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including devDependencies (for building)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy other required assets
# Preserving directory structure as expected by code using process.cwd()
COPY --from=builder /app/src/graphql ./src/graphql
COPY --from=builder /app/src/certs ./src/certs
COPY --from=builder /app/public ./public
COPY --from=builder /app/resources ./resources

# Create uploads directory
RUN mkdir -p uploads

# Set environment to production
ENV NODE_ENV=production

# Expose port (default NestJS port)
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"]
