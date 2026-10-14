# Production Hardened Dockerfile for Server A Edge Ingestion Gateway
FROM python:3.11-alpine

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    EDGE_GATEWAY_HOST=0.0.0.0 \
    EDGE_GATEWAY_PORT=8001

# Install runtime dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy gateway microservice
COPY . /app/v2/edge_gateway

# Non-root user for edge container security
RUN adduser -D gatewayuser && chown -R gatewayuser /app
USER gatewayuser

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8001/healthz || exit 1

CMD ["python", "-m", "uvicorn", "v2.edge_gateway.app:app", "--host", "0.0.0.0", "--port", "8001"]
