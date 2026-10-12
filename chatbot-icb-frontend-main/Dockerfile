# ---- build de Angular ----
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

# ---- Nginx: sirve el front y hace de proxy de /api al backend (HTTPS en 443) ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist/icb-chatbot/browser /usr/share/nginx/html
# La configuración y los certificados se montan desde deploy/nginx (ver docker-compose.yml)
EXPOSE 443
