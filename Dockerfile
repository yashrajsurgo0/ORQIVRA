FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY webapp/frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY webapp/frontend/ ./
ENV REACT_APP_PUBLIC_DEMO=true
ENV GENERATE_SOURCEMAP=false
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 ORQIVRA_PUBLIC_DEMO=1
WORKDIR /app
COPY requirements-deploy.txt ./
RUN pip install --no-cache-dir -r requirements-deploy.txt
COPY webapp/backend/ ./webapp/backend/
COPY --from=frontend /build/build/ ./webapp/frontend/build/
RUN useradd --create-home appuser
USER appuser
EXPOSE 10000
CMD ["sh", "-c", "exec gunicorn --chdir webapp/backend --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 4 --timeout 120 app:app"]
