FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
WORKDIR /srv/syseval
COPY backend/requirements.lock ./backend/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r backend/requirements.lock
COPY backend/ ./backend/
RUN pip install --no-cache-dir --no-deps ./backend
COPY --from=frontend /build/dist ./frontend/dist
COPY control-import.example.csv ./control-import.example.csv
RUN useradd --create-home --uid 10001 syseval && chown -R syseval:syseval /srv/syseval
USER syseval
ENV PYTHONPATH=/srv/syseval/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
