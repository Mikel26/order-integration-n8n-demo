FROM node:24.12.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:24.12.0-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist/server ./dist/server
COPY database/migrations ./database/migrations
USER node
CMD ["node", "dist/server/apps/ingress-api/src/main.js"]

FROM build AS web-build
RUN npm run build:web
FROM nginx:1.28.0-alpine AS web
COPY --from=web-build /app/dist/web/browser /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
