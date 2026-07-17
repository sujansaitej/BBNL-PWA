# BBNL PWA — build the Vite bundle, serve it with server.js (which also
# proxies the IPTV live-TV streams over HTTP/2, so this cannot be a plain
# static image).

# Debian, not alpine: several devDependencies ship prebuilt glibc-only
# binaries (ngrok has no musl build at all; esbuild/rollup resolve different
# musl packages), so `npm ci` fails on alpine.
FROM node:22-slim AS builder
WORKDIR /app

# package-lock.json is gitignored in this repo (.gitignore:21), so it is never
# in the build context — hence `npm install`, not `npm ci`. The trailing glob
# picks the lockfile up automatically if that policy ever changes, without
# failing the COPY while it doesn't exist.
COPY package.json package-lock.json* ./

# --ignore-scripts skips ngrok's postinstall, which downloads a dev-tunnel
# binary this image has no use for. esbuild and rollup are unaffected: their
# linux binaries come from optional dependencies (@esbuild/linux-x64,
# @rollup/rollup-linux-x64-gnu) that npm installs directly and both resolve at
# runtime rather than from a postinstall step.
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund --ignore-scripts; \
    else \
      npm install --no-audit --no-fund --ignore-scripts; \
    fi

COPY . .

# Vite bakes VITE_* in at build time. vite.config.js calls
# loadEnv(mode, cwd, '') — the empty prefix means it also reads plain
# process.env — but .env.production is gitignored (it holds credentials and
# this repo is public), so CI has to supply it. One base64 arg carries the
# whole file, so adding a VITE_* var later needs no Dockerfile edit.
# Builder stage only: never copied into the runtime image below.
ARG ENV_FILE_B64=""
RUN if [ -n "$ENV_FILE_B64" ]; then \
      echo "$ENV_FILE_B64" | base64 -d > .env.production; \
      echo "wrote .env.production ($(grep -c . .env.production) lines)"; \
    else \
      echo "WARNING: no ENV_FILE_B64 — build will have no API config"; \
    fi

RUN npm run build && test -f dist/index.html

# ---------- runtime ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# server.js imports only node: builtins, so no npm install is needed here.
COPY server.js package.json ./
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.js"]
