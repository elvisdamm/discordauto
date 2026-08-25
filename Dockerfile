FROM node:20-bookworm-slim

WORKDIR /app

# dependencias nativas para better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY . .

# Railway inyecta PORT automaticamente
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/data.sqlite
EXPOSE 3000

CMD ["node", "server.js"]
