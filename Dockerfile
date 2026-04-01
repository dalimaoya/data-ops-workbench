# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# Stage 2: Python backend
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies for pyodbc and psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ unixodbc-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/app ./app

# Copy built frontend into backend/web
COPY --from=frontend-builder /build/dist ./web

# Create data and backup directories
RUN mkdir -p /app/data /app/backups

# Set environment variables
ENV DATA_OPS_DATA_DIR=/app/data
ENV PORT=9590

EXPOSE 9590

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9590"]
