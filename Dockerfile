FROM --platform=linux/arm64 ghcr.io/puppeteer/puppeteer:25.1.0

USER root
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*
USER pptruser

WORKDIR /home/pptruser/app

COPY --chown=pptruser:pptruser package*.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
COPY --chown=pptruser:pptruser bot.js ./

ENV DISPLAY=:99
ENV HEADLESS=false

# Start xvfb in background, then run bot
ENTRYPOINT ["sh", "-c", "rm -f /tmp/.X99-lock && Xvfb :99 -screen 0 1280x720x24 -nolisten tcp & sleep 1 && node bot.js"]