# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN npm ci \
  && cd frontend \
  && npm ci

FROM deps AS build
WORKDIR /app

COPY assets ./assets
COPY public ./public
COPY scripts ./scripts
COPY src ./src
COPY templates ./templates
COPY frontend ./frontend
COPY tsconfig.json vitest.config.ts ./

RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HEXNEST_WEB_HOST=0.0.0.0
ENV HEXNEST_WEB_PORT=3000
ENV HEXNEST_WEB_PORT_STRICT=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/public ./public
COPY --from=build /app/templates ./templates

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/src/index.js"]
