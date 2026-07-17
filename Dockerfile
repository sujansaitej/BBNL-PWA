# BBNL PWA — build the Vite bundle, serve it with server.js (which also
# proxies the IPTV live-TV streams over HTTP/2, so this cannot be a plain
# static image).

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes VITE_* in at build time. vite.config.js calls
# loadEnv(mode, cwd, '') — the empty prefix means it also picks up plain
# process.env — but .env.production is gitignored (it holds credentials and
# this repo is public), so CI has to supply it. One base64 arg carries the
# whole file, which means adding a VITE_* var later needs no Dockerfile edit.
# Builder stage only: never copied into the runtime image below.
ARG ENV_FILE_B64=""
RUN if [ -n "$ENV_FILE_B64" ]; then \
      echo "$ENV_FILE_B64" | base64 -d > .env.production; \
      echo "env.production written ($(grep -c . .env.production) lines)"; \
    else \
      echo "WARNING: no ENV_FILE_B64 — build will have no API config"; \
    fi

RUN npm run build && test -f dist/index.html

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# server.js is dependency-free (node built-ins only), so no npm install here.
COPY server.js ./
COPY package.json ./
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.js"]
