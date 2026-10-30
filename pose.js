// Detecção de pose no navegador com MediaPipe (@mediapipe/tasks-vision).
//
// Os arquivos do MediaPipe são procurados primeiro na pasta vendor/ e model/ (rode
// baixar_arquivos.py para criá-las: assim o app funciona offline). Se não existirem,
// são baixados da internet na primeira vez e guardados pelo service worker.

const VERSAO_CDN = "0.10.21";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO_CDN}`;
const MODELO_REMOTO =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
const MODELO_LOCAL = new URL("../model/pose_landmarker_full.task", import.meta.url).href;

let modulo = null;

async function carregarMediapipe() {
  if (modulo) return modulo;
  try {
    const m = await import("../vendor/vision_bundle.mjs");
    modulo = { PoseLandmarker: m.PoseLandmarker, FilesetResolver: m.FilesetResolver, wasm: new URL("../vendor/wasm", import.meta.url).href, origem: "local" };
  } catch {
    const m = await import(`${CDN}/vision_bundle.mjs`);
    modulo = { PoseLandmarker: m.PoseLandmarker, FilesetResolver: m.FilesetResolver, wasm: `${CDN}/wasm`, origem: "internet" };
  }
  return modulo;
}

async function urlDoModelo() {
  try {
    const r = await fetch(MODELO_LOCAL, { method: "HEAD" });
    // alguns servidores devolvem a página inicial (HTML) para arquivos que não existem
    if (r.ok && !(r.headers.get("content-type") || "").includes("text/html")) return MODELO_LOCAL;
  } catch { /* sem rede ou arquivo ausente */ }
  return MODELO_REMOTO;
}

/**
 * Cria o detector. Interface: { iniciarVideo(), detectar(video, tMs) -> Float32Array(132) | null }.
 * Para testes, defina globalThis.__ttDetectorFactory.
 */
export async function criarDetector(aoStatus = () => {}) {
  if (globalThis.__ttDetectorFactory) return globalThis.__ttDetectorFactory();
  aoStatus("Carregando o modelo de pose (só na primeira vez)…");
  const { PoseLandmarker, FilesetResolver, wasm } = await carregarMediapipe();
  const fileset = await FilesetResolver.forVisionTasks(wasm);
  const modelo = await urlDoModelo();
  const criar = (delegate) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelo, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let delegate = "GPU";
  let lm;
  try {
    lm = await criar("GPU");
  } catch {
    delegate = "CPU";
    lm = await criar("CPU");
  }

  let base = 0;
  let ultimo = 0;
  const converter = (res) => {
    const pts = res?.landmarks?.[0];
    if (!pts) return null;
    const kp = new Float32Array(33 * 4);
    for (let j = 0; j < 33 && j < pts.length; j++) {
      kp[j * 4] = pts[j].x;
      kp[j * 4 + 1] = pts[j].y;
      kp[j * 4 + 2] = pts[j].z ?? 0;
      kp[j * 4 + 3] = pts[j].visibility ?? 0;
    }
    return kp;
  };

  return {
    get delegate() { return delegate; },
    iniciarVideo() { base = ultimo + 1000; }, // o MediaPipe exige tempos sempre crescentes
    async detectar(video, tMs) {
      const ts = Math.max(ultimo + 1, Math.round(base + tMs));
      ultimo = ts;
      try {
        return converter(lm.detectForVideo(video, ts));
      } catch (e) {
        if (delegate === "GPU") { // algumas placas de vídeo falham só na hora de usar
          delegate = "CPU";
          lm = await criar("CPU");
          return converter(lm.detectForVideo(video, ts));
        }
        throw e;
      }
    },
  };
}

function esperarEvento(el, evento, ms = 15000) {
  return new Promise((resolve, reject) => {
    const fim = (e) => { clearTimeout(t); el.removeEventListener(evento, ok); el.removeEventListener("error", erro); e ? reject(e) : resolve(); };
    const ok = () => fim(null);
    const erro = () => fim(new Error("video"));
    const t = setTimeout(() => fim(new Error("tempo")), ms);
    el.addEventListener(evento, ok, { once: true });
    el.addEventListener("error", erro, { once: true });
  });
}

/** Posiciona o vídeo no instante t (segundos) e espera o quadro ficar pronto. */
export async function irPara(video, t) {
  const alvo = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - alvo) < 1e-4 && video.readyState >= 2) return;
  const pronto = esperarEvento(video, "seeked", 8000);
  video.currentTime = alvo;
  await pronto;
}

/**
 * Lê o vídeo quadro a quadro (amostrando em fpsAmostragem) e devolve os pontos do corpo.
 * Devolve { kp, fps, largura, altura, duracao, video, liberar }. Chame liberar() ao terminar de usar `video`.
 */
export async function extrairPoseDoVideo(arquivo, detector, { fpsAmostragem = 30, maxSeg = 60, aoProgresso = () => {}, sinal } = {}) {
  const url = URL.createObjectURL(arquivo);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const liberar = () => { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); };
  try {
    try {
      await esperarEvento(video, "loadedmetadata");
      if (video.readyState < 2) await esperarEvento(video, "loadeddata");
    } catch {
      throw new Error("Seu navegador não conseguiu abrir esse vídeo. Tente um arquivo .mp4 (H.264) ou .webm, ou outro navegador.");
    }
    const duracao = video.duration;
    if (!Number.isFinite(duracao) || duracao <= 0) throw new Error("Não consegui descobrir a duração desse vídeo.");
    if (duracao > maxSeg) throw new Error(`Vídeo longo demais (${Math.round(duracao)} s). O limite é ${maxSeg} s: corte para poucos golpes e tente de novo.`);
    const largura = video.videoWidth, altura = video.videoHeight;
    const total = Math.floor(duracao * fpsAmostragem);
    if (total < 10) throw new Error("O vídeo é curto demais para analisar.");

    detector.iniciarVideo?.();
    const kp = [];
    for (let i = 0; i < total; i++) {
      if (sinal?.aborted) throw new DOMException("Cancelado", "AbortError");
      const t = i / fpsAmostragem;
      await irPara(video, t);
      const pts = await detector.detectar(video, t * 1000);
      kp.push(pts || new Float32Array(33 * 4));
      if (i % 3 === 0) aoProgresso(i / total);
    }
    aoProgresso(1);
    return { kp, fps: fpsAmostragem, largura, altura, duracao, video, liberar };
  } catch (e) {
    liberar();
    throw e;
  }
}
