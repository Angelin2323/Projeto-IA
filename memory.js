// Memória da IA: guarda, neste aparelho, as medidas dos golpes (nunca o vídeo).
// Equivalente a tt_coach/memory.py, com localStorage no lugar de arquivos.

const CHAVE = "ttcoach.memoria.v1";
const FORMATO = "ttcoach-memoria";
const MAX_REGISTROS_IMPORTADOS = 5000;

/** 'Braço esticado' -> 'braco_esticado' (sem acentos, minúsculo, com underscores). */
export function normalizarTag(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Identificador estável do arquivo (evita contar o mesmo vídeo duas vezes). */
export async function idDoVideo(arquivo) {
  try {
    const buf = await arquivo.slice(0, 4 * 1024 * 1024).arrayBuffer();
    const h = await crypto.subtle.digest("SHA-1", buf);
    const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
    return `${hex}-${arquivo.size.toString(36)}`;
  } catch {
    return `n-${arquivo.name}-${arquivo.size}-${arquivo.lastModified}`;
  }
}

class ArmazenamentoLocal {
  ler() {
    try {
      const lista = JSON.parse(localStorage.getItem(CHAVE) || "[]");
      return Array.isArray(lista) ? lista : [];
    } catch {
      return [];
    }
  }
  gravar(registros) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(registros));
      return true;
    } catch {
      return false;
    }
  }
}

const texto = (v, max) => String(v ?? "").slice(0, max);

export class Memoria {
  constructor(armazenamento = new ArmazenamentoLocal()) {
    this.arm = armazenamento;
    this.registros = this.arm.ler();
    this.erroGravacao = false;
  }

  _salvar() {
    this.erroGravacao = !this.arm.gravar(this.registros);
  }

  adicionar({ video, videoId, rotulo, golpe, lado, erros, features, t }) {
    const id = this.registros.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    this.registros.push({
      id, video: texto(video, 120), video_id: videoId, rotulo, golpe, lado, erros, t: Math.round(t * 100) / 100,
      features, criado_em: new Date().toISOString().slice(0, 19),
    });
    this._salvar();
    return id;
  }

  removerPorVideoId(videoId) {
    const antes = this.registros.length;
    this.registros = this.registros.filter((r) => r.video_id !== videoId);
    if (this.registros.length !== antes) this._salvar();
    return antes - this.registros.length;
  }

  apagarTudo() {
    this.registros = [];
    this._salvar();
  }

  listar(rotulo = null, golpe = null) {
    return this.registros.filter((r) => (rotulo === null || r.rotulo === rotulo) && (golpe === null || r.golpe === golpe));
  }

  videos() {
    const mapa = new Map();
    for (const r of this.registros) {
      const v = mapa.get(r.video_id) || { video_id: r.video_id, video: r.video, golpe: r.golpe, rotulo: r.rotulo, erros: r.erros, golpes: 0, criado_em: r.criado_em };
      v.golpes++;
      mapa.set(r.video_id, v);
    }
    return [...mapa.values()].sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
  }

  resumo() {
    const mapa = new Map();
    for (const r of this.registros) {
      const chave = `${r.golpe}|${r.rotulo}`;
      const g = mapa.get(chave) || { golpe: r.golpe, rotulo: r.rotulo, golpes: 0, videos: new Set() };
      g.golpes++;
      g.videos.add(r.video_id);
      mapa.set(chave, g);
    }
    return [...mapa.values()]
      .map((g) => ({ ...g, videos: g.videos.size }))
      .sort((a, b) => (a.golpe + a.rotulo).localeCompare(b.golpe + b.rotulo));
  }

  tags() {
    return [...new Set(this.registros.flatMap((r) => r.erros || []))].sort();
  }

  exportarJSON() {
    return JSON.stringify({ formato: FORMATO, versao: 1, exportado_em: new Date().toISOString(), registros: this.registros }, null, 1);
  }

  /** Junta uma memória exportada com a atual. Vídeos que já existem aqui são ignorados. */
  importarJSON(conteudo) {
    let dados;
    try {
      dados = JSON.parse(conteudo);
    } catch {
      throw new Error("Esse arquivo não é um JSON válido.");
    }
    const lista = Array.isArray(dados) ? dados : dados?.registros;
    if (!Array.isArray(lista) || (!Array.isArray(dados) && dados.formato !== FORMATO)) {
      throw new Error("Esse arquivo não parece ser uma memória exportada pelo TT Coach.");
    }
    const existentes = new Set(this.registros.map((r) => r.video_id));
    let adicionados = 0, ignorados = 0;
    for (const r of lista.slice(0, MAX_REGISTROS_IMPORTADOS)) {
      const valido = r && typeof r === "object" && (r.rotulo === "correto" || r.rotulo === "errado") &&
        typeof r.video_id === "string" && r.features && typeof r.features === "object" &&
        Object.values(r.features).every((x) => typeof x === "number" && Number.isFinite(x));
      if (!valido || existentes.has(r.video_id)) { ignorados++; continue; }
      const id = this.registros.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      this.registros.push({
        id, video: texto(r.video, 120), video_id: texto(r.video_id, 80), rotulo: r.rotulo,
        golpe: normalizarTag(texto(r.golpe, 40)) || "geral", lado: r.lado === "esquerdo" ? "esquerdo" : "direito",
        erros: (Array.isArray(r.erros) ? r.erros : []).slice(0, 5).map((e) => normalizarTag(texto(e, 40))).filter(Boolean),
        t: Number.isFinite(r.t) ? r.t : 0, features: { ...r.features }, criado_em: texto(r.criado_em, 30),
      });
      adicionados++;
    }
    if (adicionados) this._salvar();
    return { adicionados, ignorados };
  }
}
