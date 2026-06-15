# Memory MCP gateway — built by docker-compose.yml (build: ./memory-mcp)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 9100
# Healthcheck path matches docker-compose.yml (/healthz on MEMORY_MCP_PORT)
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:9100/healthz || exit 1
CMD ["node", "dist/server.js"]
