FROM node:22.19.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json seed.json ./
COPY src ./src
RUN npm run build
FROM node:22.19.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY seed.json ./
COPY --from=build /app/dist ./dist
EXPOSE 4100
CMD ["node", "dist/src/server.js"]
