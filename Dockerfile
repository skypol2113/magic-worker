# -------- Base (builder) --------
FROM node:20-slim AS base
WORKDIR /app

# Оптимизация кеша: сначала package*.json
COPY package*.json ./
RUN npm ci --omit=dev

# -------- Runtime image --------
FROM node:20-slim
ENV NODE_ENV=production \
    PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY . .

# Cloud Run подставит свой PORT (обычно 8080). Локально остаётся 3000.
EXPOSE 3000 8080

CMD ["node", "index.js"]