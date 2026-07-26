FROM node:20-slim

# ffmpeg (extraction des frames vidéo) + curl (pour télécharger yt-dlp)
# + python3 (nécessaire pour exécuter yt-dlp)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "index.js"]
