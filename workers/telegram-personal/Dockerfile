# TENH Telegram Personal worker. NOT deployed; reviewed draft for Phase C.
# glibc base: prebuilt-tdlib ships Linux x86_64 builds that need glibc >= 2.17.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

# Session data lives on a persistent, encrypted volume mounted here.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
ENV TELEGRAM_PERSONAL_DATA_DIR=/data

USER node
# The platform must allow at least TELEGRAM_PERSONAL_CLOSE_TIMEOUT_MS (+ margin)
# between SIGTERM and SIGKILL so TDLib can flush and close every session.
STOPSIGNAL SIGTERM
CMD ["node", "src/index.ts"]
