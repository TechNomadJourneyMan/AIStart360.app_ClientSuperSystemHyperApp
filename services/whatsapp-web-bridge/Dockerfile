FROM node:22-bookworm-slim AS dependencies

WORKDIR /service
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8787 \
    BRIDGE_AUTH_DIR=/data/auth \
    BRIDGE_STATE_DIR=/data/state

RUN groupadd --system --gid 10001 bridge \
  && useradd --system --uid 10001 --gid bridge --home-dir /service bridge \
  && mkdir -p /service /data/auth /data/state \
  && chown -R bridge:bridge /service /data

WORKDIR /service
COPY --from=dependencies --chown=bridge:bridge /service/node_modules ./node_modules
COPY --chown=bridge:bridge \
  package.json \
  package-lock.json \
  server.mjs \
  catch-up-policy.mjs \
  bridge-reliability.mjs \
  portal-job-drain-kicker.mjs \
  portal-outbound-puller.mjs \
  ./

USER bridge
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.mjs"]
