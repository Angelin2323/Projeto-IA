// Detecção de golpes e características biomecânicas.
// Port fiel de tt_coach/features.py (versão Python do projeto).
//
// Entrada: kp = lista de quadros; cada quadro é um Float32Array(33*4) com [x, y, z, visibilidade]
// por ponto do corpo (formato MediaPipe Pose), x e y normalizados (0..1).

export const IDX = {
  NARIZ: 0,
  OMBRO: { esquerdo: 11, direito: 12 },
  COTOVELO: { esquerdo: 13, direito: 14 },
  PUNHO: { esquerdo: 15, direito: 16 },
  QUADRIL: { esquerdo: 23, direito: 24 },
  JOELHO: { esquerdo: 25, direito: 26 },
  TORNOZELO: { esquerdo: 27, direito: 28 },
};

// nome interno -> [rótulo, unidade]
export const NOMES_FEATURES = {
  cotovelo_angulo: ["Ângulo do cotovelo no contato", "°"],
  joelho_flexao: ["Flexão dos joelhos", "°"],
  tronco_inclinacao: ["Inclinação do tronco", "°"],
  rotacao_ombros: ["Rotação dos ombros", "× tronco"],
  altura_contato: ["Altura do punho no contato", "× tronco"],
  cotovelo_afastamento: ["Afastamento do cotovelo", "× tronco"],
  amplitude_swing: ["Amplitude do movimento do braço", "× tronco"],
  velocidade_pico: ["Velocidade máxima do punho", "× tronco/s"],
  base_pes: ["Abertura dos pés", "× ombros"],
  estabilidade_cabeca: ["Movimento da cabeça", "× tronco"],
};

const LIMIAR_VISIBILIDADE = 0.4;
const LIMIAR_VELOCIDADE_MIN = 2.0; // em comprimentos de tronco por segundo
const ANTES_DO_CONTATO = 0.35; // segundos analisados antes do pico de velocidade
const DEPOIS_DO_CONTATO = 0.25; // segundos analisados depois
const SEPARACAO_GOLPES = 0.6; // segundos mínimos entre dois golpes

export class PoseRuim extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "PoseRuim";
  }
}

/** Média móvel de 3 pontos (bordas repetidas). NaN continua NaN. */
function suavizar(x) {
  const n = x.length;
  if (n < 3) return x;
  const saida = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    saida[t] = (x[Math.max(0, t - 1)] + x[t] + x[Math.min(n - 1, t + 1)]) / 3;
  }
  return saida;
}

/** Preenche com interpolação linear os quadros em que o ponto estava pouco visível. */
function interpolar(arr, idx) {
  const vals = idx.map((i) => arr[i]);
  const ultimo = idx.length - 1;
  let k = 0;
  for (let t = 0; t < arr.length; t++) {
    if (t <= idx[0]) arr[t] = vals[0];
    else if (t >= idx[ultimo]) arr[t] = vals[ultimo];
    else {
      while (idx[k + 1] < t) k++;
      const f = (t - idx[k]) / (idx[k + 1] - idx[k]);
      arr[t] = vals[k] + (vals[k + 1] - vals[k]) * f;
    }
  }
}

function prepararPontos(kp, largura, altura) {
  const T = kp.length;
  const N = 33;
  const X = [];
  const Y = [];
  const fracao = new Array(N).fill(0);
  for (let j = 0; j < N; j++) {
    const xs = new Float64Array(T);
    const ys = new Float64Array(T);
    const ok = [];
    for (let t = 0; t < T; t++) {
      xs[t] = kp[t][j * 4] * largura;
      ys[t] = kp[t][j * 4 + 1] * altura;
      if (kp[t][j * 4 + 3] >= LIMIAR_VISIBILIDADE) ok.push(t);
    }
    fracao[j] = T ? ok.length / T : 0;
    if (ok.length >= 2) {
      interpolar(xs, ok);
      interpolar(ys, ok);
    } else {
      xs.fill(NaN);
      ys.fill(NaN);
    }
    X.push(suavizar(xs));
    Y.push(suavizar(ys));
  }
  return { X, Y, fracao };
}

function mediana(a) {
  if (!a.length || a.some((v) => !Number.isFinite(v))) return NaN;
  const s = Array.from(a).sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentil(a, p) {
  const s = Array.from(a).sort((x, y) => x - y);
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function angulo(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by, v2x = cx - bx, v2y = cy - by;
  const den = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-9;
  const c = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / den));
  return (Math.acos(c) * 180) / Math.PI;
}

function acharPicos(v, fps) {
  if (v.length < 5) return [];
  const limiar = Math.max(LIMIAR_VELOCIDADE_MIN, 0.45 * percentil(v, 98));
  const cand = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] >= limiar && v[i] >= v[i - 1] && v[i] >= v[i + 1]) cand.push(i);
  }
  cand.sort((a, b) => v[b] - v[a]);
  const sep = Math.max(1, Math.floor(SEPARACAO_GOLPES * fps));
  const escolhidos = [];
  for (const i of cand) {
    if (escolhidos.every((j) => Math.abs(i - j) >= sep)) escolhidos.push(i);
  }
  return escolhidos.sort((a, b) => a - b);
}

/**
 * Detecta os golpes do vídeo e calcula as características de cada um.
 * Devolve [{frame, t, janela:[a,b], features:{...}}].
 */
export function extrairGolpes(kp, fps, largura, altura, lado = "direito") {
  if (lado !== "direito" && lado !== "esquerdo") throw new Error("lado deve ser 'direito' ou 'esquerdo'");
  const { X, Y, fracao } = prepararPontos(kp, largura, altura);
  const T = kp.length;
  const oE = IDX.OMBRO.esquerdo, oD = IDX.OMBRO.direito;
  const qE = IDX.QUADRIL.esquerdo, qD = IDX.QUADRIL.direito;
  const cot = IDX.COTOVELO[lado], pun = IDX.PUNHO[lado], quadLado = IDX.QUADRIL[lado], omb = IDX.OMBRO[lado];

  const essenciais = [oE, oD, qE, qD, cot, pun];
  if (essenciais.some((j) => fracao[j] < 0.3)) {
    throw new PoseRuim(
      "O corpo (ombros, quadril e braço que bate) não foi detectado em pelo menos 30% dos quadros. " +
        "Filme o jogador inteiro, de corpo todo, com boa iluminação."
    );
  }

  const msX = new Float64Array(T), msY = new Float64Array(T), mqX = new Float64Array(T), mqY = new Float64Array(T);
  const tronco = new Float64Array(T), largOmbros = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    msX[t] = (X[oE][t] + X[oD][t]) / 2;
    msY[t] = (Y[oE][t] + Y[oD][t]) / 2;
    mqX[t] = (X[qE][t] + X[qD][t]) / 2;
    mqY[t] = (Y[qE][t] + Y[qD][t]) / 2;
    tronco[t] = Math.hypot(msX[t] - mqX[t], msY[t] - mqY[t]);
    largOmbros[t] = Math.hypot(X[oE][t] - X[oD][t], Y[oE][t] - Y[oD][t]);
  }
  const L = mediana(tronco);
  const larguraOmbros = mediana(largOmbros);
  if (!(L > 20)) throw new PoseRuim("O jogador aparece muito pequeno no vídeo. Aproxime a câmera.");

  const relX = new Float64Array(T), relY = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    relX[t] = X[pun][t] - X[omb][t];
    relY[t] = Y[pun][t] - Y[omb][t];
  }
  const v0 = new Float64Array(T);
  for (let t = 1; t < T; t++) v0[t] = (Math.hypot(relX[t] - relX[t - 1], relY[t] - relY[t - 1]) * fps) / L;
  const v = suavizar(v0);

  const golpes = [];
  for (const i of acharPicos(v, fps)) {
    const a = Math.max(0, i - Math.floor(ANTES_DO_CONTATO * fps));
    const b = Math.min(T - 1, i + Math.floor(DEPOIS_DO_CONTATO * fps));
    if (b - a < 5) continue;
    const f = {};

    f.cotovelo_angulo = angulo(X[omb][i], Y[omb][i], X[cot][i], Y[cot][i], X[pun][i], Y[pun][i]);

    let somaJoelho = 0;
    for (let t = a; t <= b; t++) {
      somaJoelho +=
        (angulo(X[qE][t], Y[qE][t], X[IDX.JOELHO.esquerdo][t], Y[IDX.JOELHO.esquerdo][t], X[IDX.TORNOZELO.esquerdo][t], Y[IDX.TORNOZELO.esquerdo][t]) +
          angulo(X[qD][t], Y[qD][t], X[IDX.JOELHO.direito][t], Y[IDX.JOELHO.direito][t], X[IDX.TORNOZELO.direito][t], Y[IDX.TORNOZELO.direito][t])) / 2;
    }
    f.joelho_flexao = somaJoelho / (b - a + 1);

    const dx = msX[i] - mqX[i], dy = msY[i] - mqY[i];
    f.tronco_inclinacao = (Math.atan2(Math.abs(dx), -dy) * 180) / Math.PI;

    let lmin = Infinity, lmax = -Infinity;
    for (let t = a; t <= b; t++) {
      const l = largOmbros[t] / L;
      lmin = Math.min(lmin, l);
      lmax = Math.max(lmax, l);
    }
    f.rotacao_ombros = lmax - lmin;

    f.altura_contato = (Y[omb][i] - Y[pun][i]) / L;
    f.cotovelo_afastamento = Math.hypot(X[cot][i] - X[quadLado][i], Y[cot][i] - Y[quadLado][i]) / L;

    let amp = 0;
    for (let t = a; t < b; t++) amp += Math.hypot(relX[t + 1] - relX[t], relY[t + 1] - relY[t]);
    f.amplitude_swing = amp / L;
    f.velocidade_pico = v[i];

    const tzE = IDX.TORNOZELO.esquerdo, tzD = IDX.TORNOZELO.direito;
    if (Number.isFinite(X[tzE][i] + Y[tzE][i] + X[tzD][i] + Y[tzD][i]) && larguraOmbros > 1) {
      f.base_pes = Math.hypot(X[tzE][i] - X[tzD][i], Y[tzE][i] - Y[tzD][i]) / larguraOmbros;
    }

    const nx = X[IDX.NARIZ], ny = Y[IDX.NARIZ];
    let n = 0, mx = 0, my = 0, finito = true;
    for (let t = a; t <= b; t++) {
      if (!Number.isFinite(nx[t] + ny[t])) { finito = false; break; }
      n++; mx += nx[t]; my += ny[t];
    }
    if (finito) {
      mx /= n; my /= n;
      let vx = 0, vy = 0;
      for (let t = a; t <= b; t++) { vx += (nx[t] - mx) ** 2; vy += (ny[t] - my) ** 2; }
      f.estabilidade_cabeca = Math.sqrt(vx / n + vy / n) / L;
    }

    for (const k of Object.keys(f)) if (!Number.isFinite(f[k])) delete f[k];
    golpes.push({ frame: i, t: i / fps, janela: [a, b], features: f });
  }
  return golpes;
}
