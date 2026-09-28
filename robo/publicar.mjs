// 3ª etapa: junta o que as partes baixaram ao estado, tira da base o que
// passou de MESES meses e monta os arquivos que a Pesquisa de Preços lê.
//
// estado/  (só para o robô)
//   p/XX.ndjson.gz  contratações já baixadas, uma por linha, em 16 partes
//   fila.json.gz    o que ainda falta baixar (carga inicial em andamento)
//   vistos.json.gz  controle -> data de atualização já baixada
//   cursor.json     até onde cada modalidade já foi listada
// web/     (o que o navegador lê, direto do GitHub)
//   meta.json       resumo: total, período, municípios, unidades, blocos
//   b/N.json.gz     blocos de ~1.000 preços, em ordem de descrição (itens
//                   parecidos ficam juntos: uma busca abre poucos blocos)
//   i/XXX.json.gz   índice, repartido pelas três primeiras letras da palavra
//                   (palavra de duas letras: arquivo de duas). Para cada
//                   palavra, as linhas da base em que ela aparece (a
//                   primeira, depois a distância para a anterior): a tela
//                   cruza as palavras buscadas, sabe exatamente que blocos
//                   têm o item e quantos preços cada um tem, e baixa só
//                   esses, do que mais tem para o que menos tem. Palavra
//                   comum demais (mais de LIMITE_LINHAS linhas) guarda só
//                   {b: [bloco, quantas linhas, ...]}, que é bem menor.
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import {
  MESES, UF, MODALIDADES, lerJson, gravarJson, lerLinhas, gravarLinhas, arquivos, parteDe, hojeISO, menosMeses,
  idPreco, norm, normUnidade,
} from "./comum.mjs";

const RAIZ = process.env.RAIZ || ".";
const PARTES_ESTADO = 16;
const POR_BLOCO = +process.env.POR_BLOCO || 1000;
const LIMITE_LINHAS = +process.env.LIMITE_LINHAS || 100000;
// Versão do formato de web/ (a tela lê as duas: a 1 tinha índice por duas
// letras e só a lista de blocos de cada palavra)
const FORMATO = 2;

// Linhas de uma palavra no índice: a primeira e as distâncias (números
// pequenos, que comprimem bem); comum demais, só os blocos e as contagens.
export function codificarLinhas(linhas, porBloco, limite = LIMITE_LINHAS) {
  if (linhas.length > limite) {
    const b = [];
    for (const i of linhas) {
      const n = Math.floor(i / porBloco);
      if (b[b.length - 2] !== n) b.push(n, 0);
      b[b.length - 1]++;
    }
    return { b };
  }
  return linhas.map((x, k) => (k ? x - linhas[k - 1] : x));
}
// Palavras que não ajudam a achar nada (aparecem em quase tudo)
const VAZIAS = new Set("de da do das dos e em para com sem por a o as os na no nas nos ao aos ou um uma tipo cor".split(" "));

export function palavras(texto) {
  return norm(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 2 && !VAZIAS.has(p));
}
export const arqIndice = (p) => p.slice(0, 3);
// Nome do arquivo de um prefixo. CON, PRN, AUX e NUL são nomes proibidos
// no Windows (mesmo com extensão): quem clonar o ramo lá — ou o sistema de
// Ijuí, que guarda uma amostra desta base nos testes — não consegue nem
// fazer o checkout. Esses quatro ganham um "_".
export const nomeArqIndice = (k) => (/^(con|prn|aux|nul)$/.test(k) ? k + "_" : k);
// Chave de ordem da base: a descrição sem acento, sem o que vem antes da
// primeira letra ("1 - Leite", "- LEITE" ficam junto com "Leite")
export const chaveOrdem = (n) => n.replace(/^[^a-z]+/, "") || n;
const INICIO_TAM = 24;

// Data de referência de uma contratação: o resultado mais recente
function dataRef(r) {
  let d = "";
  for (const i of r.it || []) for (const x of i[5]) if (x[4] && x[4] > d) d = x[4];
  return d || r.ab || r.pub || "";
}

export function juntarEstado(raiz, hoje = hojeISO()) {
  const corte = menosMeses(hoje, MESES);
  const base = new Map();
  for (const arq of arquivos(join(raiz, "estado", "p"), /\.ndjson\.gz$/)) for (const r of lerLinhas(arq)) base.set(r.c, r);
  let novos = 0;
  const feitos = new Map();
  for (const arq of arquivos(join(raiz, "trab"), /^baixado-\d+\.ndjson\.gz$/)) {
    for (const r of lerLinhas(arq)) { base.set(r.c, r); feitos.set(r.c, r.at); novos++; }
  }
  // o que passou do corte sai da base
  let podados = 0;
  for (const [c, r] of base) { const d = dataRef(r); if (d && d < corte) { base.delete(c); podados++; } }
  // fila: a anterior + o que foi listado agora, menos o que acabou de ser baixado
  const fila = new Map();
  for (const e of lerJson(join(raiz, "estado", "fila.json.gz"), [])) fila.set(e.c, e);
  const cursor = lerJson(join(raiz, "estado", "cursor.json"), {});
  cursor.carga = cursor.carga || {};
  for (const arq of arquivos(join(raiz, "trab"), /^lista-\d+\.json$/)) {
    const l = lerJson(arq, null);
    if (!l) continue;
    l.fila.forEach((e) => fila.set(e.c, e));
    if (l.cursor) cursor.carga[l.mod] = l.cursor;
  }
  for (const [c, at] of feitos) { const e = fila.get(c); if (e && e.at === at) fila.delete(c); }
  for (const [c, e] of fila) if ((e.pub || "") && e.pub < corte && (e.ab || e.pub) < corte) fila.delete(c);
  const vistos = {};
  for (const [c, r] of base) vistos[c] = r.at;
  return { base, fila, cursor, vistos, corte, novos, podados };
}

export function montarWeb(base, { corte, hoje = hojeISO(), fila = 0, cursor = {}, porBloco = POR_BLOCO, limiteLinhas = LIMITE_LINHAS } = {}) {
  const precos = [];
  for (const r of base.values()) {
    for (const [n, desc, un, tipo, qtdItem, res] of r.it || []) {
      res.forEach(([forn, doc, qtd, v, d], k) => {
        const data = d || r.ab || r.pub || "";
        if (!(v > 0) || (data && data < corte)) return;
        const nd = norm(desc);
        precos.push({ id: idPreco(`${r.c}#${n}#${k}`), desc, n: chaveOrdem(nd), un: normUnidade(un), v, q: qtd != null ? qtd : qtdItem, d: data, r, forn, doc });
      });
    }
  }
  precos.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : b.d.localeCompare(a.d)));

  const municipios = [...new Set([...base.values()].map((r) => r.mun).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
  const idxMun = new Map(municipios.map((m, i) => [m, i]));
  const unidades = [...new Set(precos.map((p) => p.un))].sort();
  const idxUn = new Map(unidades.map((u, i) => [u, i]));

  const blocos = [], indice = new Map();
  for (let b = 0; b * porBloco < precos.length; b++) {
    const fatia = precos.slice(b * porBloco, (b + 1) * porBloco);
    const procs = [], idxP = new Map(), forns = [], idxF = new Map();
    const linhas = fatia.map((p) => {
      let pi = idxP.get(p.r.c);
      if (pi === undefined) {
        pi = procs.length; idxP.set(p.r.c, pi);
        procs.push([p.r.o, p.r.a, p.r.s, p.r.mod, p.r.num, idxMun.has(p.r.mun) ? idxMun.get(p.r.mun) : -1, p.r.org]);
      }
      const fk = p.forn + "|" + p.doc;
      let fi = idxF.get(fk);
      if (fi === undefined) { fi = forns.length; idxF.set(fk, fi); forns.push([p.forn, p.doc]); }
      return [p.id, p.desc, idxUn.get(p.un), p.v, p.q, p.d, pi, fi];
    });
    blocos.push({ p: procs, f: forns, r: linhas });
  }
  // índice: palavra -> linhas (em ordem), repartido por prefixo
  precos.forEach((p, i) => {
    for (const w of new Set(palavras(p.desc))) {
      let a = indice.get(w); if (!a) indice.set(w, (a = []));
      a.push(i);
    }
  });
  const porPrefixo = new Map();
  for (const [w, linhas] of indice) {
    const k = arqIndice(w);
    let arq = porPrefixo.get(k); if (!arq) porPrefixo.set(k, (arq = {}));
    arq[w] = codificarLinhas(linhas, porBloco, limiteLinhas);
  }
  // quais arquivos de índice existem, agrupados pelas duas primeiras letras:
  // {"ar": ".rmo"} = i/ar, i/arr, i/arm, i/aro ("." = o de duas letras)
  const prefixos = {};
  for (const k of [...porPrefixo.keys()].sort()) prefixos[k.slice(0, 2)] = (prefixos[k.slice(0, 2)] || "") + (k[2] || ".");
  // onde cada bloco começa (a chave de ordem da 1ª linha, encurtada): como os
  // blocos seguem a ordem da descrição, a tela acha os blocos dos itens que
  // COMEÇAM com a palavra buscada e os baixa antes dos outros
  const inicios = blocos.map((_, b) => precos[b * porBloco].n.slice(0, INICIO_TAM));
  const meta = {
    formato: FORMATO, geradoEm: new Date().toISOString(), hoje, uf: UF, meses: MESES, de: corte,
    precos: precos.length, contratacoes: base.size, blocos: blocos.length, porBloco, pendentes: fila,
    municipios, unidades, modalidades: MODALIDADES, prefixos, inicios,
    carga: Object.fromEntries(Object.entries(cursor.carga || {}).map(([m, c]) => [m, !!c.feita])),
  };
  return { meta, blocos, porPrefixo };
}

async function main() {
  const hoje = hojeISO();
  const { base, fila, cursor, vistos, corte, novos, podados } = juntarEstado(RAIZ, hoje);
  // estado
  const partes = Array.from({ length: PARTES_ESTADO }, () => []);
  for (const r of base.values()) partes[parteDe(r.c, PARTES_ESTADO)].push(r);
  const dirP = join(RAIZ, "estado", "p");
  if (existsSync(dirP)) rmSync(dirP, { recursive: true });
  partes.forEach((l, i) => gravarLinhas(join(dirP, String(i).padStart(2, "0") + ".ndjson.gz"), l));
  gravarJson(join(RAIZ, "estado", "fila.json.gz"), [...fila.values()]);
  gravarJson(join(RAIZ, "estado", "vistos.json.gz"), vistos);
  cursor.atualizadoEm = new Date().toISOString();
  gravarJson(join(RAIZ, "estado", "cursor.json"), cursor, { bonito: true });
  // web
  const { meta, blocos, porPrefixo } = montarWeb(base, { corte, hoje, fila: fila.size, cursor });
  const dirW = join(RAIZ, "web");
  if (existsSync(dirW)) rmSync(dirW, { recursive: true });
  blocos.forEach((b, i) => gravarJson(join(dirW, "b", i + ".json.gz"), b));
  for (const [k, m] of porPrefixo) gravarJson(join(dirW, "i", nomeArqIndice(k) + ".json.gz"), m);
  gravarJson(join(dirW, "meta.json"), meta);
  console.log(`Base: ${base.size} contratações (${novos} baixadas agora, ${podados} saíram por passar de ${MESES} meses), ${meta.precos} preços de ${meta.municipios.length} municípios, ${blocos.length} blocos; fila: ${fila.size}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
