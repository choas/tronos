# TronOS Dockerfile
# Multi-stage build for production deployment

# Stage 1: Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Stage 2: Production stage with nginx
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Support environment variables for AI config at runtime
# These can be passed via docker run -e or docker-compose
ENV TRONOS_API_KEY=""
ENV TRONOS_AI_PROVIDER="anthropic"
ENV TRONOS_AI_MODEL="claude-sonnet-4-20250514"

# Create a script to inject env vars into the app at runtime
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-inject-env.sh && \
    echo 'if [ -n "$TRONOS_API_KEY" ]; then' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo '  echo "window.__TRONOS_CONFIG__ = {" > /usr/share/nginx/html/config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo '  echo "  apiKey: \"$TRONOS_API_KEY\"," >> /usr/share/nginx/html/config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo '  echo "  aiProvider: \"${TRONOS_AI_PROVIDER:-anthropic}\"," >> /usr/share/nginx/html/config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo '  echo "  aiModel: \"${TRONOS_AI_MODEL:-claude-sonnet-4-20250514}\"" >> /usr/share/nginx/html/config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo '  echo "};" >> /usr/share/nginx/html/config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo 'fi' >> /docker-entrypoint.d/40-inject-env.sh && \
    chmod +x /docker-entrypoint.d/40-inject-env.sh

# Expose port 80 for web access
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# Use nginx's default entrypoint which runs scripts in /docker-entrypoint.d/
CMD ["nginx", "-g", "daemon off;"]
