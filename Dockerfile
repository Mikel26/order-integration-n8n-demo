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

