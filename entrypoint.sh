#!/bin/sh
set -e

# MediGuide AI Production Entrypoint
# Handles database connection waiting and application startup

echo "Starting MediGuide AI Backend..."

# Wait for MongoDB to be ready
echo "Waiting for MongoDB connection..."
max_retries=30
retry_count=0

while [ $retry_count -lt $max_retries ]; do
    if nc -z ${MONGODB_URL#*//} 2>/dev/null || [ -n "$MONGODB_HOST" ]; then
        echo "MongoDB is ready"
        break
    fi
    retry_count=$((retry_count + 1))
    echo "Waiting for MongoDB... ($retry_count/$max_retries)"
    sleep 2
done

if [ $retry_count -eq $max_retries ]; then
    echo "Warning: MongoDB may not be ready, starting anyway..."
fi

# Seed database if not skipped
if [ "$SKIP_SEEDING" != "true" ]; then
    echo "Seeding database..."
    python scripts/seed_database.py || echo "Database seeding completed or not needed"
fi

# Run the application
echo "Starting application server..."
exec "$@"