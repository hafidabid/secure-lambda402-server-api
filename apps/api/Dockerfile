# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN npm ci
RUN npm run build:libs && npm run build -w @securelambda/api

FROM build AS run
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "apps/api/dist/main.js"]
