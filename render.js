// Desenha o quadro de um golpe com o esqueleto e o veredito (equivalente a tt_coach/render.py).
import { irPara } from "./pose.js";

const CONEXOES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];

const ROTULO_DIR = { alto: "(alto)", baixo: "(baixo)" };

export async function desenharGolpe(video, dados, golpe, res, canvas) {
  await irPara(video, golpe.frame / dados.fps);
  const larg = Math.min(720, dados.largura);
  const esc = larg / dados.largura;
  canvas.width = larg;
  canvas.height = Math.round(dados.altura * esc);
  const c = canvas.getContext("2d");
  c.drawImage(video, 0, 0, canvas.width, canvas.height);

  const pts = dados.kp[golpe.frame];
  const espessura = Math.max(2, canvas.width / 320);
  c.lineWidth = espessura;
  c.strokeStyle = "#ffc800";
  for (const [a, b] of CONEXOES) {
    if (pts[a * 4 + 3] > 0.5 && pts[b * 4 + 3] > 0.5) {
      c.beginPath();
      c.moveTo(pts[a * 4] * canvas.width, pts[a * 4 + 1] * canvas.height);
      c.lineTo(pts[b * 4] * canvas.width, pts[b * 4 + 1] * canvas.height);
      c.stroke();
    }
  }
  c.fillStyle = "#00c8ff";
  for (let j = 0; j < 33; j++) {
    if (pts[j * 4 + 3] > 0.5) {
      c.beginPath();
      c.arc(pts[j * 4] * canvas.width, pts[j * 4 + 1] * canvas.height, espessura * 1.2, 0, 7);
      c.fill();
    }
  }

  const linhas = [`Golpe ${res.indice}: ${res.veredito} (${res.nota}/100)`,
    ...res.problemas.slice(0, 3).map((p) => `${p.rotulo} ${ROTULO_DIR[p.direcao]}`)];
  const fonte = Math.max(14, Math.round(canvas.width / 30));
  c.font = `600 ${fonte}px system-ui, sans-serif`;
  const alturaLinha = fonte * 1.4;
  const larguraCaixa = Math.min(canvas.width - 16, Math.max(...linhas.map((l) => c.measureText(l).width)) + 24);
  c.fillStyle = "rgba(20,20,20,.78)";
  c.fillRect(8, 8, larguraCaixa, alturaLinha * linhas.length + 12);
  linhas.forEach((l, k) => {
    c.fillStyle = k === 0 ? (res.veredito === "CORRETO" ? "#4ade80" : "#f87171") : "#ffffff";
    c.fillText(l, 20, 8 + alturaLinha * (k + 1));
  });
}
