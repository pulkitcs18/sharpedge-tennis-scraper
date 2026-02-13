FROM ghcr.io/puppeteer/puppeteer:22.0.0
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
CMD ["node", "dist/runner.js"]
