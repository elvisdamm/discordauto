FROM node:20-bookworm-slim

WORKDIR /app

# dependencias nativas para better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production --build-from-source
RUN npm rebuild better-sqlite3 --build-from-source || true
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 load ok')"

COPY . .

# Railway inyecta PORT automaticamente
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/data.sqlite
EXPOSE 3000

CMD ["node", "server.js"]
