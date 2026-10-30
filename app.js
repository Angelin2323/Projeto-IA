// Interface do TT Coach: tudo roda neste aparelho (nenhum vídeo é enviado para fora).
import { extrairGolpes } from "./features.js";
import { avaliarVideo, fmt } from "./analyzer.js";
import { Memoria, normalizarTag, idDoVideo } from "./memory.js";
import { criarDetector, extrairPoseDoVideo } from "./pose.js";
import { desenharGolpe } from "./render.js";

const MAX_SEG = 60;
const EXTENSOES = /\.(mp4|mov|avi|mkv|m4v|webm|3gp)$/i;
const $ = (id) => document.getElementById(id);
const memoria = new Memoria();
let ocupado = false;
let cancelador = null;
let detectorPromise = null;

function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "texto") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f);
  return e;
}

const obterDetector = (aoStatus) =>
  (detectorPromise ||= criarDetector(aoStatus).catch((e) => { detectorPromise = null; throw e; }));

// ---------- abas
function abrirAba(nome) {
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === nome)));
  for (const a of ["analisar", "treinar", "memoria"]) $("aba-" + a).classList.toggle("oculto", a !== nome);
  if (nome === "memoria") renderMemoria();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => abrirAba(b.dataset.aba)));

// ---------- escolher arquivos
function ligarArea(area, input, aoEscolher) {
  area.addEventListener("click", () => input.click());
  area.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { aoEscolher([...input.files]); input.value = ""; });
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("sobre"); });
  area.addEventListener("dragleave", () => area.classList.remove("sobre"));
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.classList.remove("sobre");
    aoEscolher([...e.dataTransfer.files].filter((f) => f.type.startsWith("video/") || EXTENSOES.test(f.name)));
  });
}

// ---------- tarefa longa (uma por vez, com progresso e cancelamento)
async function executar({ botoes, barra, estado, cancelar }, tarefa) {
  if (ocupado) return;
  ocupado = true;
  cancelador = new AbortController();
  botoes.forEach((b) => (b.disabled = true));
  cancelar.classList.remove("oculto");
  barra.classList.remove("oculto");
  const preench = barra.firstElementChild;
  preench.style.width = "0%";
  estado.textContent = "Preparando…"; // não deixa o “Pronto!” da tarefa anterior na tela
  const progresso = (p, texto) => {
    preench.style.width = `${Math.round(p * 100)}%`;
    barra.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    if (texto) estado.textContent = texto;
  };
  try {
    return await tarefa(progresso, cancelador.signal);
  } finally {
    ocupado = false;
    cancelador = null;
    cancelar.classList.add("oculto");
    botoes.forEach((b) => (b.disabled = false));
    atualizarBotoes();
  }
}
for (const id of ["btn-cancelar-analisar", "btn-cancelar-treinar"]) $(id).addEventListener("click", () => cancelador?.abort());

async function lerVideo(arquivo, progresso, sinal, textoBase) {
  const detector = await obterDetector((t) => progresso(0, t));
  return extrairPoseDoVideo(arquivo, detector, {
    maxSeg: MAX_SEG,
    sinal,
    aoProgresso: (p) => progresso(p, `${textoBase} ${Math.round(p * 100)}%`),
  });
}

function mensagemDeErro(e) {
  if (e?.name === "AbortError") return "Cancelado.";
  return e?.message || "Erro inesperado.";
}

// ---------- analisar
let arqAnalisar = null;
ligarArea($("solta-analisar"), $("arq-analisar"), (fs) => {
  arqAnalisar = fs[0] || null;
  $("nome-analisar").textContent = arqAnalisar ? arqAnalisar.name : "ou arraste um arquivo aqui";
  atualizarBotoes();
});

$("btn-analisar").addEventListener("click", () => {
  const arquivo = arqAnalisar;
  const lado = $("lado-analisar").value;
  const tipo = normalizarTag($("golpe-analisar").value) || null;
  const sens = Number($("sens").value) || 2.5;
  $("resultado").replaceChildren();
  executar(
    { botoes: [$("btn-analisar")], barra: $("barra-analisar"), estado: $("estado-analisar"), cancelar: $("btn-cancelar-analisar") },
    async (progresso, sinal) => {
      let dados = null;
      try {
        dados = await lerVideo(arquivo, progresso, sinal, "Detectando o corpo no vídeo…");
        const golpes = extrairGolpes(dados.kp, dados.fps, dados.largura, dados.altura, lado);
        const res = avaliarVideo(golpes, memoria, tipo, sens);
        $("estado-analisar").textContent = "Desenhando os golpes…";
        await mostrarResultado(res, golpes, dados);
        $("estado-analisar").textContent = "Pronto!";
      } catch (e) {
        $("estado-analisar").textContent = "";
        $("resultado").replaceChildren(el("div", { class: "falha", texto: mensagemDeErro(e) }));
      } finally {
        dados?.liberar();
      }
    }
  );
});

async function mostrarResultado(r, golpes, dados) {
  const classe = r.resumo.veredito === "SEM GOLPES" ? "SEMGOLPES" : r.resumo.veredito;
  const card = el("div", { class: "card" },
    el("div", { class: "veredito" },
      el("h2", { texto: "Resultado" }),
      el("span", { class: `selo ${classe}`, texto: r.resumo.veredito }),
      r.resumo.n ? el("span", { class: "chip", texto: `${r.resumo.n_errados} de ${r.resumo.n} golpes com problemas` }) : null),
    r.modo === "referencia"
      ? el("p", { class: "dica", texto: `Comparado com a sua memória: ${r.n_referencia} golpes corretos (${r.tipo_golpe}).` })
      : el("div", { class: "aviso", texto: `Modo genérico: a memória ainda tem poucos golpes corretos (${r.n_referencia}; o mínimo é 3). As regras são aproximadas. Na aba “Treinar a IA”, envie vídeos de golpes corretos para uma análise personalizada.` }));
  if (!r.resumo.n) card.append(el("div", { class: "aviso", texto: "Nenhum golpe foi detectado. Confira se o corpo inteiro aparece, se a câmera está parada e se a mão escolhida está certa." }));
  if (r.resumo.recorrentes.length) {
    card.append(el("h2", { texto: "Problemas que se repetem", style: "margin-top:14px" }),
      el("ul", {}, r.resumo.recorrentes.map((x) => el("li", { texto: `${x.mensagem} (${x.vezes}/${r.resumo.n} golpes)` }))));
  }
  const canvases = [];
  for (const g of r.golpes) {
    const canvas = el("canvas", { role: "img", "aria-label": `Quadro do golpe ${g.indice}` });
    canvases.push(canvas);
    card.append(el("div", { class: "golpe" }, canvas, el("div", {},
      el("div", { class: "veredito" },
        el("b", { texto: `Golpe ${g.indice} (em ${g.t.toFixed(1)} s)` }),
        el("span", { class: `selo ${g.veredito}`, texto: g.veredito }),
        el("span", { class: "chip", texto: `${g.nota}/100` })),
      g.problemas.length ? null : el("p", { class: "dica", texto: "Nada fora do padrão neste golpe." }),
      g.problemas.map((p) => el("div", { class: `problema ${p.gravidade}` },
        el("b", { texto: `${p.rotulo}: ${valorFormatado(p)}` }),
        el("small", { texto: `${p.gravidade} · esperado ${p.esperado}` }),
        el("div", { texto: p.mensagem }))),
      g.parecido_com.length ? el("p", {}, "Parece com erro já cadastrado: ", g.parecido_com.map((t) => el("span", { class: "tag", texto: t }))) : null)));
  }
  $("resultado").replaceChildren(card);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  for (let k = 0; k < r.golpes.length; k++) await desenharGolpe(dados.video, dados, golpes[k], r.golpes[k], canvases[k]);
}

const valorFormatado = (p) => fmt(p.feature, p.valor);

// ---------- treinar
let filaTreinar = [];
function listarFila(status = {}) {
  $("lista-treinar").replaceChildren(...filaTreinar.map((f, i) =>
    el("li", {}, el("span", { texto: f.name }), el("span", { class: "estado", texto: status[i] || "" }))));
  atualizarBotoes();
}
ligarArea($("solta-treinar"), $("arq-treinar"), (fs) => { filaTreinar = fs; listarFila(); });
document.querySelectorAll("input[name=rotulo]").forEach((r) => r.addEventListener("change", () =>
  $("campo-erro").classList.toggle("oculto", document.querySelector("input[name=rotulo]:checked").value !== "errado")));

$("btn-treinar").addEventListener("click", () => {
  const arquivos = [...filaTreinar];
  const rotulo = document.querySelector("input[name=rotulo]:checked").value;
  const golpe = normalizarTag($("golpe-treinar").value) || "geral";
  const lado = $("lado-treinar").value;
  const erros = rotulo === "errado"
    ? $("erro-treinar").value.split(",").map(normalizarTag).filter(Boolean).slice(0, 5)
    : [];
  executar(
    { botoes: [$("btn-treinar")], barra: $("barra-treinar"), estado: $("estado-treinar"), cancelar: $("btn-cancelar-treinar") },
    async (progresso, sinal) => {
      const status = {};
      for (let i = 0; i < arquivos.length; i++) {
        const f = arquivos[i];
        let dados = null;
        try {
          const id = await idDoVideo(f);
          dados = await lerVideo(f, progresso, sinal, `Vídeo ${i + 1} de ${arquivos.length}: detectando o corpo…`);
          const golpes = extrairGolpes(dados.kp, dados.fps, dados.largura, dados.altura, lado);
          if (!golpes.length) { status[i] = "nenhum golpe detectado"; }
          else {
            memoria.removerPorVideoId(id); // reenviar o mesmo vídeo substitui o anterior
            for (const g of golpes) memoria.adicionar({ video: f.name, videoId: id, rotulo, golpe, lado, erros, features: g.features, t: g.t });
            status[i] = `✓ ${golpes.length} golpes guardados`;
          }
        } catch (e) {
          status[i] = `erro: ${mensagemDeErro(e)}`;
          if (e?.name === "AbortError") { listarFila(status); break; }
        } finally {
          dados?.liberar();
        }
        listarFila(status);
      }
      $("estado-treinar").textContent = memoria.erroGravacao
        ? "Atenção: o aparelho não deixou guardar (armazenamento cheio ou bloqueado). Exporte um backup na aba Memória."
        : "Concluído.";
      pedirArmazenamentoPersistente();
      atualizarChip();
    }
  );
});

// ---------- memória
function atualizarChip() {
  $("chip-memoria").textContent = `memória: ${memoria.listar("correto").length} golpes corretos`;
  $("lista-golpes").replaceChildren(...[...new Set(memoria.registros.map((r) => r.golpe))].map((g) => el("option", { value: g })));
}

function renderMemoria() {
  atualizarChip();
  const resumo = memoria.resumo();
  const tags = memoria.tags();
  $("resumo-memoria").replaceChildren(
    resumo.length
      ? el("div", { class: "rolavel" }, el("table", {},
          el("tr", {}, ["Golpe", "Tipo", "Golpes", "Vídeos"].map((h) => el("th", { texto: h }))),
          resumo.map((g) => el("tr", {}, el("td", { texto: g.golpe }),
            el("td", {}, el("span", { class: `selo ${g.rotulo === "correto" ? "CORRETO" : "ERRADO"}`, texto: g.rotulo })),
            el("td", { texto: String(g.golpes) }), el("td", { texto: String(g.videos) })))))
      : el("p", { class: "dica", texto: "A memória está vazia. Use a aba “Treinar a IA”." }),
    tags.length ? el("p", {}, "Erros cadastrados: ", tags.map((t) => el("span", { class: "tag", texto: t }))) : "");
  const videos = memoria.videos();
  $("videos-memoria").replaceChildren(videos.length
    ? el("table", {}, el("tr", {}, ["Vídeo", "Tipo", "Marcado como", "Golpes", ""].map((h) => el("th", { texto: h }))),
        videos.map((v) => el("tr", {}, el("td", { texto: v.video }), el("td", { texto: v.golpe }),
          el("td", { texto: v.rotulo + (v.erros.length ? ` (${v.erros.join(", ")})` : "") }),
          el("td", { texto: String(v.golpes) }),
          el("td", {}, el("button", { class: "btn sec pequeno", type: "button", texto: "Remover", onclick: () => {
            if (!confirm(`Remover “${v.video}” da memória?`)) return;
            memoria.removerPorVideoId(v.video_id);
            renderMemoria();
          } })))))
    : el("p", { class: "dica", texto: "Nenhum vídeo ainda." }));
  mostrarTextoArmazenamento();
}

async function mostrarTextoArmazenamento() {
  let persistente = null;
  try { persistente = await navigator.storage?.persisted?.(); } catch { /* sem suporte */ }
  $("texto-armazenamento").textContent =
    "Sua memória fica guardada só neste aparelho e neste navegador, sem conta e sem servidor. " +
    "Se você limpar os dados do navegador, ou (no iPhone) ficar muito tempo sem abrir o app, ela pode ser apagada. " +
    "Exporte um backup de vez em quando; ele também serve para levar a memória para outro aparelho." +
    (persistente === true ? " O navegador marcou estes dados como protegidos." : "");
}

async function pedirArmazenamentoPersistente() {
  try { await navigator.storage?.persist?.(); } catch { /* sem suporte */ }
}

$("btn-exportar").addEventListener("click", () => {
  if (!memoria.registros.length) { $("estado-memoria").textContent = "Não há nada para exportar ainda."; return; }
  const blob = new Blob([memoria.exportarJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `ttcoach-memoria-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $("estado-memoria").textContent = "Backup exportado.";
});
$("btn-importar").addEventListener("click", () => $("arq-importar").click());
$("arq-importar").addEventListener("change", async (e) => {
  const arq = e.target.files[0];
  e.target.value = "";
  if (!arq) return;
  try {
    const { adicionados, ignorados } = memoria.importarJSON(await arq.text());
    $("estado-memoria").textContent = `Importado: ${adicionados} golpes novos` + (ignorados ? ` (${ignorados} ignorados: já existiam ou eram inválidos).` : ".");
    renderMemoria();
  } catch (err) {
    $("estado-memoria").textContent = err.message;
  }
});
$("btn-apagar").addEventListener("click", () => {
  if (!confirm("Apagar TODA a memória deste aparelho? Isso não pode ser desfeito. Exporte um backup antes se quiser guardá-la.")) return;
  memoria.apagarTudo();
  $("estado-memoria").textContent = "Memória apagada.";
  renderMemoria();
});

// ---------- estado dos botões
function atualizarBotoes() {
  $("btn-analisar").disabled = ocupado || !arqAnalisar;
  $("btn-treinar").disabled = ocupado || !filaTreinar.length;
}

// ---------- instalação do app
let eventoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  $("btn-instalar").classList.remove("oculto");
});
$("btn-instalar").addEventListener("click", async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice.catch(() => {});
  eventoInstalar = null;
  $("btn-instalar").classList.add("oculto");
});
window.addEventListener("appinstalled", () => $("btn-instalar").classList.add("oculto"));
const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const jaInstalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (ehIOS && !jaInstalado) $("dica-ios").classList.remove("oculto");

// ---------- service worker (funcionar offline)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

atualizarChip();
atualizarBotoes();
