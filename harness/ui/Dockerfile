FROM node:22.19.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_STACK_URL
ARG NEXT_PUBLIC_ZITADEL_ISSUER=http://localhost:8080
ARG NEXT_PUBLIC_ZITADEL_CLIENT_ID
ENV NEXT_PUBLIC_STACK_URL=$NEXT_PUBLIC_STACK_URL NEXT_PUBLIC_ZITADEL_ISSUER=$NEXT_PUBLIC_ZITADEL_ISSUER NEXT_PUBLIC_ZITADEL_CLIENT_ID=$NEXT_PUBLIC_ZITADEL_CLIENT_ID
RUN npm run build
FROM node:22.19.0-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3100
CMD ["node", "server.js"]

