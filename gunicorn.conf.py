# Gunicorn configuration for MediGuide AI Production
# For production deployment with Uvicorn workers

import multiprocessing

# Server configuration
bind = "0.0.0.0:8000"
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 30
keepalive = 2

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Process management
pidfile = "/tmp/gunicorn.pid"
pre_fork = None
post_fork = None
pre_exec = None
daemon = False
user = None
group = None
tmp_upload_dir = None

# Security
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190

# Graceful shutdown
graceful_timeout = 30
max_requests = 1000
max_requests_jitter = 100

# Resource limits
rlimit_no_file = 32768

# Server headers
proc_name = "mediguide-backend"
preload_app = True

# Debug
debug = False
check_config = True
print_config = False