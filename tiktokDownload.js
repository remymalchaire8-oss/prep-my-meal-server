const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { v4: uuid } = require("uuid");

const execFileAsync = promisify(execFile);

// Récupère la durée de la vidéo (en secondes) via ffprobe.
async function getVideoDuration(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = parseFloat(stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

// Télécharge une vidéo TikTok publique avec yt-dlp puis extrait des frames
// RÉPARTIES SUR TOUTE LA DURÉE de la vidéo avec ffmpeg (au lieu de juste les
// premières secondes), pour ne pas rater des ingrédients montrés plus tard
// dans la vidéo. Nécessite que yt-dlp, ffmpeg et ffprobe soient installés
// sur la machine qui exécute le serveur (voir README).
async function downloadAndExtractFrames(videoUrl, frameCount = 8) {
  const workDir = path.join(os.tmpdir(), `prepmymeal-${uuid()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const videoPath = path.join(workDir, "video.mp4");

  console.log(`[tiktok] Téléchargement démarré pour ${videoUrl}`);
  try {
    // Timeout explicite de 45s : sans ça, si TikTok bloque/ralentit les
    // téléchargements depuis l'IP du serveur cloud, yt-dlp peut rester
    // bloqué indéfiniment sans jamais renvoyer d'erreur ni de log.
    await execFileAsync(
      "yt-dlp",
      ["-f", "mp4", "-o", videoPath, videoUrl],
      { timeout: 45000 }
    );
    console.log(`[tiktok] Téléchargement terminé pour ${videoUrl}`);
  } catch (err) {
    cleanup(workDir);
    const timedOut = err.killed || err.signal === "SIGTERM";
    console.error(`[tiktok] Échec du téléchargement pour ${videoUrl}:`, err.message);
    throw new Error(
      timedOut
        ? "Le téléchargement de la vidéo a expiré (45s). TikTok bloque parfois les téléchargements depuis les serveurs cloud — réessaie, ou teste avec un autre lien."
        : "Échec du téléchargement de la vidéo TikTok. Vérifie le lien et que yt-dlp est installé. Détail: " +
            err.message
    );
  }

  // Calcule un fps qui répartit ~frameCount images sur toute la durée de
  // la vidéo (au lieu d'un fps fixe qui ne couvrait que les 4 premières
  // secondes). Si la durée n'a pas pu être lue, on retombe sur fps=1.
  let duration = 0;
  try {
    duration = await getVideoDuration(videoPath);
  } catch (_) {
    duration = 0;
  }
  const fps = duration > 0 ? Math.max(frameCount / duration, 0.2) : 1;

  const framePattern = path.join(workDir, "frame-%02d.jpg");
  try {
    await execFileAsync("ffmpeg", [
      "-i",
      videoPath,
      "-vf",
      `fps=${fps}`,
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
