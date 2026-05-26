FROM python:3.11-slim

WORKDIR /app

# Bring in the API package and the seed samples. samples/ lives at the repo
# root so it can be referenced from docs and tests too; the Dockerfile is
# how it reaches the API runtime in production.
COPY api/ ./api/
COPY samples/ ./samples/

RUN pip install --no-cache-dir -e ./api

EXPOSE 8080

# Railway sets $PORT; default to 8080 for local docker runs.
CMD ["sh", "-c", "cd api && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
