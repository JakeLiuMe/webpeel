FROM node:20-slim

# Install Playwright dependencies
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy built files
COPY dist/ ./dist/

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server/app.js"]
