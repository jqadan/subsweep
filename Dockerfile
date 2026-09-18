# SubSweep — builds and runs the app in ./subsweep from the repo root, so
# Railway (or any Docker host) needs no root-directory or branch settings.
FROM node:22-slim

WORKDIR /app
COPY subsweep/package.json subsweep/package-lock.json ./
RUN npm ci --omit=dev

COPY subsweep/ ./

ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 3100
CMD ["node", "server.js"]
