# MediGuide AI Deployment Guide

This document provides comprehensive instructions for deploying MediGuide AI to production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Local Development)](#quick-start-local-development)
3. [Production Deployment](#production-deployment)
4. [Environment Variables](#environment-variables)
5. [SSL/TLS Configuration](#ssltls-configuration)
6. [Backup Strategy](#backup-strategy)
7. [Monitoring](#monitoring)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **CPU**: 2+ cores (recommended 4+ for production)
- **Memory**: 4GB RAM minimum (8GB+ recommended)
- **Disk**: 10GB free space (MongoDB data grows with usage)
- **OS**: Linux (Ubuntu 22.04+, Debian 12+, CentOS Stream 9+)

### Software Requirements

- Docker Engine 24.0+ 
- Docker Compose v2.20+
- OpenSSL (for secret generation)
- A MongoDB-compatible backup solution (mongodump/mongorestore)

---

## Quick Start (Local Development)

For local development, use the simpler setup:

```bash
# 1. Copy environment file
cp .env.example .env
# Edit .env with your local settings

# 2. Start MongoDB locally (or via Docker)
docker run -d --name mediguide-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=mediguide_db \
  -v mongodb_data:/data/db \
  mongo:7.0

# 3. Seed the database
python scripts/seed_database.py

# 4. Run the backend
cd backend && uvicorn main:app --reload --port 8000

# 5. Serve the frontend (in a new terminal)
npx serve . -l 5500
```

---

## Production Deployment

### Option A: Docker Compose (Recommended for Production)

1. **Prepare Environment**

```bash
# Clone and navigate to project
cd mediguide-ai

# Copy production environment template
cp .env.production.example .env.production

# Edit .env.production with your settings (see Environment Variables section)
nano .env.production
```

2. **Generate Secure Secrets**

```bash
# Generate SECRET_KEY (copy the output)
openssl rand -hex 32

# Generate MongoDB password
openssl rand -base64 32
```

3. **Deploy**

```bash
# Start production stack
docker compose up -d --build

# Monitor logs
docker compose logs -f

# Check health
curl http://localhost:8000/health
curl http://localhost/health
```

4. **Verify Deployment**

```bash
# Check container status
docker compose ps

# Verify database seeding
curl http://localhost:8000/api/admin/stats -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test authentication flow
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"YourStrongPassword123!","consent":true}'
```

### Option B: Manual Deployment (VM/Server)

```bash
# 1. Install dependencies
sudo apt update && sudo apt install -y python3-pip python3-venv nginx

# 2. Clone repository
git clone https://github.com/your-org/mediguide-ai.git
cd mediguide-ai

# 3. Set up Python environment
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
pip install gunicorn

# 4. Set environment variables
export $(cat .env.production | xargs)

# 5. Configure Nginx (see nginx.conf in repo)
sudo cp nginx.conf /etc/nginx/nginx.conf
sudo systemctl restart nginx

# 6. Initialize database
python scripts/seed_database.py

# 7. Start with Gunicorn
gunicorn -c gunicorn.conf.py "backend.main:app"
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | ✅ Yes | - | JWT secret (min 64 chars, use `openssl rand -hex 32`) |
| `MONGODB_URL` | ✅ Yes | - | MongoDB connection string |
| `DATABASE_NAME` | ✅ Yes | `mediguide_db` | Database name |
| `ALLOWED_ORIGINS` | ✅ Yes | - | CORS allowed origins (comma-separated) |
| `ADMIN_EMAIL` | ✅ Yes | `admin@mediguide.ai` | Initial admin email |
| `ADMIN_PASSWORD` | ✅ Yes | - | Admin password (min 16 chars) |
| `MAX_UPLOAD_SIZE` | No | `10485760` | Max upload size in bytes |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `30` | JWT expiry time |
| `NODE_ENV` | No | `development` | Set to `production` for HTTPS cookies |

### Generating Secrets

```bash
# SECRET_KEY
openssl rand -hex 32

# DATABASE_NAME
echo "mediguide_db"

# MongoDB password (if using auth)
openssl rand -base64 32
```

---

## SSL/TLS Configuration

For HTTPS, use a reverse proxy (Nginx) with Let's Encrypt:

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renew test
sudo certbot renew --dry-run
```

Update Nginx config for HTTPS:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # ... existing config ...
}
```

---

## Backup Strategy

### Automated MongoDB Backup (Cron)

```bash
# Create backup script
cat > /usr/local/bin/mongodb-backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/mongodb"
mkdir -p $BACKUP_DIR

mongodump --uri="$MONGODB_URL" --gzip --archive="$BACKUP_DIR/mediguide_$DATE.gz"
find $BACKUP_DIR -name "mediguide_*.gz" -mtime +7 -delete
EOF

chmod +x /usr/local/bin/mongodb-backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add line:
0 2 * * * /usr/local/bin/mongodb-backup.sh
```

### Restore from Backup

```bash
mongorestore --uri="$MONGODB_URL" --gzip --archive=/path/to/backup.gz
```

---

## Monitoring

### Health Check Endpoints

- **Backend**: `GET /health` - Returns JSON with service status
- **Frontend**: `GET /health` - Returns "healthy" text

### Log Access

```bash
# View backend logs
docker compose logs backend -f

# View MongoDB logs
docker compose logs mongodb -f

# View Nginx logs
docker compose logs frontend -f
```

### Optional: Sentry Integration

1. Create a Sentry project at https://sentry.io
2. Add DSN to `.env.production`:

```env
SENTRY_DSN=https://key@sentry.io/project
```

3. Add Sentry initialization in `backend/main.py`:

```python
import sentry_sdk
from sentry_sdk.integrations.asgi import SentryAsgiMiddleware

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    traces_sample_rate=0.1,
)

app.add_middleware(SentryAsgiMiddleware)
```

---

## Troubleshooting

### Common Issues

#### MongoDB Connection Refused

```bash
# Check if MongoDB is running
docker compose ps mongodb

# Check connection
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# View MongoDB logs
docker compose logs mongodb
```

#### Port Already in Use

```bash
# Find process using port
lsof -i :8000  # for backend
lsof -i :80    # for frontend

# Kill process or change port
docker compose down
# Edit docker-compose.yml to change ports
docker compose up -d
```

#### Permission Denied on Uploads

```bash
# Fix permissions
chmod -R 755 uploads/
chown -R 1000:1000 uploads/  # Docker user ID may vary
```

#### Authentication Failures

```bash
# Check JWT secret is set correctly
docker compose exec backend env | grep SECRET_KEY

# Verify admin user exists
docker compose exec mongodb mongosh mediguide_db --eval "db.users.find({email: 'admin@mediguide.ai'})"
```

#### Health Check Failing

```bash
# Manual health check
curl -v http://localhost:8000/health

# Check if app is responding
docker compose exec backend curl http://localhost:8000/health
```

---

## Security Checklist

Before deploying to production:

- [ ] Generate new `SECRET_KEY` (never use default)
- [ ] Set strong `ADMIN_PASSWORD` (min 16 chars with mixed case/symbols)
- [ ] Restrict `ALLOWED_ORIGINS` to actual domains
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Change default `MONGO_ROOT_PASSWORD`
- [ ] Remove `unsafe-inline` from CSP if possible
- [ ] Enable audit logging in app
- [ ] Set up database backups
- [ ] Configure monitoring/alerting
- [ ] Review file upload restrictions
- [ ] Test 2FA (if implemented)

---

## Scaling

### Horizontal Scaling

Add more backend replicas:

```bash
docker compose up -d --scale backend=3
```

Note: Use a load balancer (Traefik, AWS ALB) for production horizontal scaling.

### Vertical Scaling

Increase resources:

```yaml
# In docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

---

## Version Information

- **Last Updated**: 2026-11-20
- **Version**: 1.0.0
- **Contact**: security@mediguide.ai for security issues