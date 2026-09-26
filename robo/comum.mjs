// Peças comuns do robô: chamadas ao PNCP (com fila, repetição e respeito ao
// limite de requisições), leitura e gravação do estado, e as normalizações.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";

export const CONSULTA = "https://pncp.gov.br/api/consulta/v1";
export const API = "https://pncp.gov.br/api/pncp/v1";
export const UF = process.env.UF || "RS";
// Quantos meses de preços ficam na base. Preço mais velho que isso não
// serve de referência (IN SEGES/ME 65/2021 pede preços recentes).
export const MESES = +process.env.MESES || 24;
// Modalidades com preço de compra. Leilão (1 e 13) é venda: fica de fora.
export const MODALIDADES = {
  4: "Concorrência - Eletrônica", 5: "Concorrência - Presencial", 6: "Pregão - Eletrônico",
  7: "Pregão - Presencial", 8: "Dispensa", 9: "Inexigibilidade", 12: "Credenciamento",
  2: "Diálogo Competitivo", 3: "Concurso", 10: "Manifestação de Interesse", 11: "Pré-qualificação",
};
export const MODS_LISTA = [6, 8, 4, 9, 7, 5, 12];

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
export const ymd = (iso) => iso.replace(/-/g, "");
export function menosMeses(iso, n) {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10);
}
export function maisDias(iso, n) {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

/* ── Orçamento de tempo: o que não couber fica para a próxima rodada ── */
const INICIO = Date.now();
const ORCAMENTO_MIN = +process.env.ORCAMENTO_MIN || 300;
export const tempoAcabou = () => Date.now() - INICIO > ORCAMENTO_MIN * 60_000;
export const minutos = () => ((Date.now() - INICIO) / 60_000).toFixed(1);

/* ── HTTP ──
   O PNCP responde 429 ("Limite de requisições excedido") para rajadas.
   Todas as chamadas passam por uma fila com teto de simultâneas e um
   intervalo mínimo entre saídas; um 429 faz a fila inteira desacelerar. */
const SIMULTANEAS = +process.env.SIMULTANEAS || 8;
let intervalo = +process.env.INTERVALO_MS || 150;
let ativas = 0, ultimaSaida = 0;
const esperando = [];
export const stats = { chamadas: 0, erros429: 0, falhas: 0 };
async function vaga() {
  if (ativas >= SIMULTANEAS) await new Promise((ok) => esperando.push(ok));
  else ativas++;
  const agora = Date.now(), falta = ultimaSaida + intervalo - agora;
  ultimaSaida = Math.max(agora, ultimaSaida + intervalo);
  if (falta > 0) await esperar(falta);
}
function libera() { const p = esperando.shift(); if (p) p(); else ativas--; }

export async function get(url, { tentativas = 7 } = {}) {
  for (let i = 0; ; i++) {
    await vaga();
    let r, t;
    try {
      stats.chamadas++;
      r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(90_000) });
      t = await r.text();
    } catch (e) {
      libera();
      if (i >= tentativas) { stats.falhas++; throw new Error(`${url}: ${e.message}`); }
      await esperar(2000 * 2 ** Math.min(i, 5));
      continue;
    }
    libera();
    if (r.status === 204 || r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) {
      if (r.status === 429) { stats.erros429++; intervalo = Math.min(3000, intervalo * 1.5 + 50); }
      if (i >= tentativas) { stats.falhas++; throw new Error(`${url}: HTTP ${r.status}`); }
      await esperar(3000 * 2 ** Math.min(i, 5));
      continue;
    }
    // devagar e sempre: sem 429 por um tempo, volta a acelerar aos poucos
    intervalo = Math.max(+process.env.INTERVALO_MS || 150, intervalo * 0.98);
    if (!r.ok) { stats.falhas++; throw new Error(`${url}: HTTP ${r.status} ${t.slice(0, 200)}`); }
    try { return t ? JSON.parse(t) : null; }
    catch (e) {
      if (i >= tentativas) { stats.falhas++; throw new Error(`${url}: resposta inválida`); }
      await esperar(2000 * 2 ** Math.min(i, 5));
    }
  }
}

export async function emParalelo(lista, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < lista.length) { const k = i++; await fn(lista[k], k); }
  }));
}

/* ── Arquivos ── */
export function lerJson(arq, padrao) {
  if (!existsSync(arq)) return padrao;
  const b = readFileSync(arq);
  return JSON.parse((arq.endsWith(".gz") ? gunzipSync(b) : b).toString("utf8"));
}
export function gravarJson(arq, obj, { gz = arq.endsWith(".gz"), bonito = false } = {}) {
  mkdirSync(dirname(arq), { recursive: true });
  const s = JSON.stringify(obj, null, bonito ? 1 : 0);
  writeFileSync(arq, gz ? gzipSync(s, { level: 9 }) : s);
}
// Um registro por linha (NDJSON), comprimido
export function lerLinhas(arq) {
  if (!existsSync(arq)) return [];
  const b = readFileSync(arq);
  return (arq.endsWith(".gz") ? gunzipSync(b) : b).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function gravarLinhas(arq, lista) {
  mkdirSync(dirname(arq), { recursive: true });
  const s = lista.map((x) => JSON.stringify(x)).join("\n") + (lista.length ? "\n" : "");
  writeFileSync(arq, arq.endsWith(".gz") ? gzipSync(s, { level: 9 }) : s);
}
export const arquivos = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f)) : []);

/* ── Hash estável (FNV-1a) ── */
export function fnv(texto, semente = 2166136261) {
  let h = semente >>> 0;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Em que parte (de N) cai uma contratação — sempre a mesma
export const parteDe = (controle, n) => fnv(controle) % n;
// Id numérico estável de um preço, acima de 2^40 para nunca coincidir com
// os ids da base de Ijuí (que ficam abaixo de 2^31).
export function idPreco(texto) {
  const a = fnv(texto), b = fnv(texto, 0x811c9dc5 ^ 0x5bd1e995) & 0xfff;
  return 2 ** 40 + b * 2 ** 32 + a;
}

/* ── Normalizações ── */
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
export const dia = (s) => (s ? String(s).slice(0, 10) : null);

// Fornecedor pessoa física: CPF mascarado, como o próprio PNCP mostra.
export function mascararDoc(d) {
  if (/\*/.test(d || "")) return d;
  const n = String(d || "").replace(/\D/g, "");
  return n.length === 11 ? `***.${n.slice(3, 6)}.${n.slice(6, 9)}-**` : n;
}
// Nome de pessoa física que vem com o CPF colado ("FULANO 12345678901")
export function limparNome(s) {
  return String(s || "").replace(/\s*\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b\s*$/, "").replace(/\s+/g, " ").trim();
}

// Mesma tabela do robô de Ijuí: "Quilogramas", "KG" e "Quilo" viram um só.
const UNIDADES = {
  unidade: "unidade", und: "unidade", un: "unidade", unid: "unidade", unidades: "unidade", ud: "unidade",
  quilograma: "quilograma", quilogramas: "quilograma", quilo: "quilograma", quilos: "quilograma", kg: "quilograma",
  grama: "grama", gramas: "grama", g: "grama", gr: "grama",
  litro: "litro", litros: "litro", l: "litro", lt: "litro", lts: "litro",
  mililitro: "mililitro", ml: "mililitro",
  metro: "metro", metros: "metro", m: "metro", mt: "metro", mts: "metro",
  metroquadrado: "metro quadrado", m2: "metro quadrado", metrosquadrados: "metro quadrado",
  metrocubico: "metro cúbico", m3: "metro cúbico", metroscubicos: "metro cúbico",
  quilometro: "quilômetro", quilometros: "quilômetro", km: "quilômetro",
  tonelada: "tonelada", toneladas: "tonelada", t: "tonelada", ton: "tonelada",
  mes: "mês", meses: "mês", hora: "hora", horas: "hora", h: "hora", hr: "hora", horamaquina: "hora máquina",
  dia: "dia", dias: "dia", diaria: "diária", diarias: "diária",
  galao: "galão", galoes: "galão", gl: "galão", peca: "peça", pecas: "peça", pc: "peça", pca: "peça",
  duzia: "dúzia", duzias: "dúzia", dz: "dúzia",
  caixa: "caixa", caixas: "caixa", cx: "caixa", pacote: "pacote", pacotes: "pacote", pct: "pacote", pc2: "pacote", pac: "pacote",
  frasco: "frasco", frascos: "frasco", fr: "frasco", fco: "frasco", embalagem: "embalagem", emb: "embalagem",
  comprimido: "comprimido", comprimidos: "comprimido", comp: "comprimido", cp: "comprimido",
  capsula: "cápsula", capsulas: "cápsula", cap: "cápsula", ampola: "ampola", ampolas: "ampola", amp: "ampola",
  kit: "kit", kits: "kit", par: "par", pares: "par", rolo: "rolo", rolos: "rolo", rl: "rolo",
  conjunto: "conjunto", cj: "conjunto", jogo: "jogo", jg: "jogo", fardo: "fardo", fd: "fardo", cento: "cento",
  lata: "lata", latas: "lata", tablete: "tablete", tubo: "tubo", tubos: "tubo", tb: "tubo", barra: "barra", barras: "barra",
  pote: "pote", potes: "pote", saco: "saco", sacos: "saco", sc: "saco", bisnaga: "bisnaga", sache: "sachê", saches: "sachê",
  envelope: "envelope", servico: "serviço", servicos: "serviço", sv: "serviço", lote: "lote", resma: "resma", resmas: "resma",
  bobina: "bobina", cartela: "cartela", folha: "folha", folhas: "folha", fl: "folha", bloco: "bloco", galao5l: "galão",
};
export function normUnidade(u) {
  const limpo = String(u || "").toLowerCase().replace(/\bnao usar\b/g, "").replace(/\s+/g, " ").trim();
  const k = norm(limpo).replace(/[^a-z0-9]/g, "");
  return UNIDADES[k] || limpo || "unidade";
}
