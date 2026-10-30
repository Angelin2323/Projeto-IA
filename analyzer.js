// Compara golpes com a memória (ou com regras genéricas) e explica o que está errado.
// Port fiel de tt_coach/analyzer.py (versão Python do projeto).

import { NOMES_FEATURES } from "./features.js";

export const MIN_EXEMPLOS_REFERENCIA = 3;

// Piso do desvio-padrão: evita que diferenças minúsculas virem "erro" quando os exemplos
// de treino são muito parecidos entre si.
const PISO_STD = {
  cotovelo_angulo: 6.0, joelho_flexao: 6.0, tronco_inclinacao: 4.0, rotacao_ombros: 0.05,
  altura_contato: 0.10, cotovelo_afastamento: 0.08, amplitude_swing: 0.25, velocidade_pico: 0.6,
  base_pes: 0.15, estabilidade_cabeca: 0.03,
};

// Estas características só são problema em uma direção.
const UM_LADO = { estabilidade_cabeca: "alto" };

// Referência genérica (aproximada!) usada quando ainda não há exemplos corretos na memória.
const REGRAS_GENERICAS = {
  cotovelo_angulo: [70, 160],
  joelho_flexao: [100, 165],
  tronco_inclinacao: [null, 35],
  base_pes: [1.0, 2.5],
  estabilidade_cabeca: [null, 0.25],
};

export const MENSAGENS = {
  cotovelo_angulo: {
    baixo: "Cotovelo muito fechado no contato: o braço está encolhido, o que limita alcance e controle.",
    alto: "Braço quase esticado no contato: mantenha o cotovelo flexionado para controlar a raquete com o antebraço.",
  },
  joelho_flexao: {
    baixo: "Agachamento exagerado: pernas muito dobradas atrapalham o deslocamento e a recuperação.",
    alto: "Pernas muito esticadas: flexione mais os joelhos para ter base e transferir o peso do corpo.",
  },
  tronco_inclinacao: {
    baixo: "Tronco mais reto que o seu padrão: falta inclinação do corpo em direção à bola.",
    alto: "Tronco inclinado demais: você perde equilíbrio e demora a se recuperar.",
  },
  rotacao_ombros: {
    baixo: "Pouca rotação dos ombros/tronco: o golpe está saindo só do braço.",
    alto: "Rotação do tronco maior que o seu padrão: girar demais atrasa a recuperação.",
  },
  altura_contato: {
    baixo: "Contato mais baixo que o padrão (punho baixo em relação ao ombro).",
    alto: "Contato mais alto que o padrão (punho alto em relação ao ombro).",
  },
  cotovelo_afastamento: {
    baixo: "Cotovelo colado ao corpo: limita a amplitude do golpe.",
    alto: "Cotovelo muito afastado do corpo: o braço abre e perde precisão.",
  },
  amplitude_swing: {
    baixo: "Movimento do braço curto: pouca amplitude de swing.",
    alto: "Movimento do braço longo demais: o swing amplo atrasa o tempo de reação.",
  },
  velocidade_pico: {
    baixo: "Punho lento em relação ao padrão: falta aceleração no golpe.",
    alto: "Punho mais rápido que o padrão: pode estar forçando e perdendo controle.",
  },
  base_pes: {
    baixo: "Base de pés estreita: afaste os pés (largura dos ombros ou mais) para ganhar estabilidade.",
    alto: "Base de pés larga demais: dificulta o deslocamento.",
  },
  estabilidade_cabeca: {
    alto: "A cabeça se mexe muito durante o golpe: tente mantê-la mais estável.",
    baixo: "A cabeça está mais parada que o padrão.",
  },
};

export function fmt(nome, valor) {
  const unidade = NOMES_FEATURES[nome][1];
  return unidade === "°" ? `${valor.toFixed(0)}°` : `${valor.toFixed(2)} ${unidade}`;
}

const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const desvioAmostral = (a) => {
  const m = media(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/** média, desvio-padrão e nº de exemplos por característica. */
export function construirReferencia(registros) {
  const ref = {};
  for (const nome of Object.keys(NOMES_FEATURES)) {
    const vals = registros.filter((r) => nome in r.features).map((r) => r.features[nome]);
    if (vals.length >= MIN_EXEMPLOS_REFERENCIA) {
      const m = media(vals);
      const std = Math.max(desvioAmostral(vals), PISO_STD[nome], 0.08 * Math.abs(m));
      ref[nome] = [m, std, vals.length];
    }
  }
  return ref;
}

function vetorZ(features, ref) {
  const z = {};
  for (const [n, v] of Object.entries(features)) if (n in ref) z[n] = (v - ref[n][0]) / ref[n][1];
  return z;
}

function cosseno(a, b) {
  const chaves = Object.keys(a).filter((k) => k in b);
  if (!chaves.length) return 0;
  let ab = 0, aa = 0, bb = 0;
  for (const k of chaves) { ab += a[k] * b[k]; aa += a[k] ** 2; bb += b[k] ** 2; }
  const den = Math.sqrt(aa) * Math.sqrt(bb);
  return den > 1e-9 ? ab / den : 0;
}

function assinaturasDeErros(registrosErrados, ref) {
  const porTag = {};
  for (const r of registrosErrados) {
    const z = vetorZ(r.features, ref);
    for (const tag of r.erros || []) (porTag[tag] ||= []).push(z);
  }
  const assinaturas = {};
  for (const [tag, zs] of Object.entries(porTag)) {
    const chaves = new Set(zs.flatMap((z) => Object.keys(z)));
    assinaturas[tag] = {};
    for (const k of chaves) assinaturas[tag][k] = media(zs.filter((z) => k in z).map((z) => z[k]));
  }
  return assinaturas;
}

function problema(feature, direcao, valor, esperado, z, gravidade) {
  return {
    feature, direcao, valor, esperado, z, gravidade,
    rotulo: NOMES_FEATURES[feature][0],
    mensagem: MENSAGENS[feature][direcao],
  };
}

function problemasPorReferencia(features, ref, limite) {
  const probs = [];
  for (const [nome, valor] of Object.entries(features)) {
    if (!(nome in ref)) continue;
    const [m, std] = ref[nome];
    const z = (valor - m) / std;
    const direcao = z > 0 ? "alto" : "baixo";
    if (Math.abs(z) < limite || (nome in UM_LADO && UM_LADO[nome] !== direcao)) continue;
    const unidade = NOMES_FEATURES[nome][1];
    const esperado = unidade === "°" ? `${m.toFixed(0)}° ± ${std.toFixed(0)}` : `${m.toFixed(2)} ± ${std.toFixed(2)} ${unidade}`;
    probs.push(problema(nome, direcao, valor, esperado, z, Math.abs(z) >= limite + 1.0 ? "grave" : "moderado"));
  }
  return probs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

function problemasGenericos(features) {
  const probs = [];
  for (const [nome, [minimo, maximo]] of Object.entries(REGRAS_GENERICAS)) {
    if (!(nome in features)) continue;
    const valor = features[nome];
    let direcao, fora;
    if (minimo !== null && valor < minimo) { direcao = "baixo"; fora = minimo - valor; }
    else if (maximo !== null && valor > maximo) { direcao = "alto"; fora = valor - maximo; }
    else continue;
    const esperado = minimo !== null && maximo !== null ? `entre ${minimo} e ${maximo}`
      : minimo === null ? `no máximo ${maximo}` : `no mínimo ${minimo}`;
    const amplo = fora > 0.2 * Math.max(Math.abs(minimo ?? 0), Math.abs(maximo ?? 0), 1e-9);
    probs.push(problema(nome, direcao, valor, esperado, null, amplo ? "grave" : "moderado"));
  }
  return probs;
}

/** Avalia todos os golpes detectados em um vídeo. */
export function avaliarVideo(golpes, memoria, tipoGolpe = null, sensibilidade = 2.5) {
  const filtro = tipoGolpe && tipoGolpe !== "geral" ? tipoGolpe : null;
  const corretos = memoria.listar("correto", filtro);
  const ref = construirReferencia(corretos);
  const modo = Object.keys(ref).length >= 3 ? "referencia" : "generico";

  let assinaturas = {};
  if (modo === "referencia") assinaturas = assinaturasDeErros(memoria.listar("errado", filtro), ref);

  const resultados = golpes.map((g, k) => {
    let probs, nota;
    if (modo === "referencia") {
      probs = problemasPorReferencia(g.features, ref, sensibilidade);
      const zs = Object.values(vetorZ(g.features, ref));
      nota = zs.length ? Math.round(100 * media(zs.map((z) => Math.exp(-0.5 * (z / 2.5) ** 2)))) : 0;
    } else {
      probs = problemasGenericos(g.features);
      nota = Math.max(0, 100 - 20 * probs.length);
    }
    let parecido = [];
    if (probs.length && Object.keys(assinaturas).length) {
      const z = vetorZ(g.features, ref);
      parecido = Object.entries(assinaturas).filter(([, s]) => cosseno(z, s) >= 0.7).map(([t]) => t);
    }
    return {
      indice: k + 1, t: g.t, frame: g.frame, janela: g.janela,
      veredito: probs.length ? "ERRADO" : "CORRETO", nota, problemas: probs, parecido_com: parecido,
    };
  });

  const n = resultados.length;
  const nErrados = resultados.filter((r) => r.veredito === "ERRADO").length;
  const cont = new Map();
  for (const r of resultados) for (const p of r.problemas) {
    const chave = `${p.feature}|${p.direcao}`;
    cont.set(chave, (cont.get(chave) || 0) + 1);
  }
  const recorrentes = [...cont.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => n && c / n >= 0.5)
    .map(([chave, c]) => { const [f, d] = chave.split("|"); return { feature: f, direcao: d, vezes: c, mensagem: MENSAGENS[f][d] }; });
  const geral = n === 0 ? "SEM GOLPES" : nErrados / n >= 0.5 ? "ERRADO" : "CORRETO";
  return {
    modo, n_referencia: corretos.length, tipo_golpe: tipoGolpe || "geral", golpes: resultados,
    resumo: { n, n_errados: nErrados, veredito: geral, recorrentes },
  };
}
