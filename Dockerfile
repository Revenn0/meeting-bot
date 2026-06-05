# Use Puppeteer's official image — comes with Chromium and all required system libs
FROM --platform=linux/arm64 ghcr.io/puppeteer/puppeteer:25.1.0

# Puppeteer image runs as non-root user 'pptruser' by default
WORKDIR /home/pptruser/app

# Copy package files first (better layer caching: deps only rebuild when package.json changes)
COPY --chown=pptruser:pptruser package*.json ./

# Install dependencies. PUPPETEER_SKIP_DOWNLOAD because Chromium is already in the base image.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev

# Copy the rest of the source
COPY --chown=pptruser:pptruser bot.js ./

# Default to headless inside Docker
ENV HEADLESS=true

# The bot expects these directories to be mounted at runtime:
#   /home/pptruser/app/media   (read-only fake video/audio files)
#   /home/pptruser/app/output  (writable, recordings end up here)
ENTRYPOINT ["node", "bot.js"]
