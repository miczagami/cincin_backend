# CinCin API — production image (used by Sevalla; runs anywhere Docker does)
FROM node:20-bookworm-slim

# Prisma's query engine needs OpenSSL
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY src ./src

USER node
# The platform sets PORT; 8080 is only the fallback for a plain `docker run`
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
