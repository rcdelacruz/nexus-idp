# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

# ── Production stage (nginx) ─────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE ${{ values.frontendPort }}
CMD ["nginx", "-g", "daemon off;"]
