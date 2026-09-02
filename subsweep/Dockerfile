FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 3100
CMD ["node", "server.js"]
