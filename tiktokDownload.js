const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { v4: uuid } = require("uuid");

const execFileAsync = promisify(execFile);

// Télécharge une vidéo TikTok publique avec yt-dlp puis extrait quelques
// frames avec ffmpeg. Nécessite que yt-dlp et ffmpeg soient installés sur
// la machine qui exécute le serveur (voir README).
async function downloadAndExtractFrames(videoUrl, frameCount = 4) {
  const workDir = path.join(os.tmpdir(), `prepmymeal-${uuid()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const videoPath = path.join(workDir, "video.mp4");

  try {
    await execFileAsync("yt-dlp", [
      "-f",
      "mp4",
      "-o",
      videoPath,
      videoUrl,
    ]);
  } catch (err) {
    cleanup(workDir);
    throw new Error(
      "Échec du téléchargement de la vidéo TikTok. Vérifie le lien et que yt-dlp est installé. Détail: " +
        err.message
    );
  }

  const framePattern = path.join(workDir, "frame-%02d.jpg");
  try {
    await execFileAsync("ffmpeg", [
      "-i",
      videoPath,
      "-vf",
      `fps=1`,
      "-frames:v",
      String(frameCount),
      framePattern,
    ]);
  } catch (err) {
    cleanup(workDir);
    throw new Error("Échec de l'extraction des images de la vidéo (ffmpeg). " + err.message);
  }

  const frameFiles = fs
    .readdirSync(workDir)
    .filter((f) => f.startsWith("frame-"))
    .sort()
    .map((f) => path.join(workDir, f));

  const framesBase64 = frameFiles.map((f) => fs.readFileSync(f).toString("base64"));

  cleanup(workDir);
  return framesBase64;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // ignore
  }
}

module.exports = { downloadAndExtractFrames };
