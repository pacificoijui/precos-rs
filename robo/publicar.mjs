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
//   b/N.json.gz     blocos de ~2.000 preços, em ordem de descrição (itens
//                   parecidos ficam juntos: uma busca abre poucos blocos)
//   i/XX.json.gz    índice: palavra -> blocos em que aparece, repartido
//                   pelas duas primeiras letras da palavra
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import {
  MESES, UF, MODALIDADES, lerJson, gravarJson, lerLinhas, gravarLinhas, arquivos, parteDe, hojeISO, menosMeses,
  idPreco, norm, normUnidade,
} from "./comum.mjs";

const RAIZ = process.env.RAIZ || ".";
const PARTES_ESTADO = 16;
const POR_BLOCO = +process.env.POR_BLOCO || 2000;
// Palavras que não ajudam a achar nada (aparecem em quase tudo)
const VAZIAS = new Set("de da do das dos e em para com sem por a o as os na no nas nos ao aos ou um uma tipo cor".split(" "));

export function palavras(texto) {
  return norm(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 2 && !VAZIAS.has(p));
}
const arqIndice = (p) => p.slice(0, 2);

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

export function montarWeb(base, { corte, hoje = hojeISO(), fila = 0, cursor = {} } = {}) {
  const precos = [];
  for (const r of base.values()) {
    for (const [n, desc, un, tipo, qtdItem, res] of r.it || []) {
      res.forEach(([forn, doc, qtd, v, d], k) => {
        const data = d || r.ab || r.pub || "";
        if (!(v > 0) || (data && data < corte)) return;
        precos.push({ id: idPreco(`${r.c}#${n}#${k}`), desc, n: norm(desc), un: normUnidade(un), v, q: qtd != null ? qtd : qtdItem, d: data, r, forn, doc });
      });
    }
  }
  precos.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : b.d.localeCompare(a.d)));

  const municipios = [...new Set([...base.values()].map((r) => r.mun).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
  const idxMun = new Map(municipios.map((m, i) => [m, i]));
  const unidades = [...new Set(precos.map((p) => p.un))].sort();
  const idxUn = new Map(unidades.map((u, i) => [u, i]));

  const blocos = [], indice = new Map();
  for (let b = 0; b * POR_BLOCO < precos.length; b++) {
    const fatia = precos.slice(b * POR_BLOCO, (b + 1) * POR_BLOCO);
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
      for (const w of palavras(p.desc)) {
        let s = indice.get(w); if (!s) indice.set(w, (s = new Set()));
        s.add(b);
      }
      return [p.id, p.desc, idxUn.get(p.un), p.v, p.q, p.d, pi, fi];
    });
    blocos.push({ p: procs, f: forns, r: linhas });
  }
  // índice repartido por prefixo; palavra que está em mais da metade dos
  // blocos não filtra nada: vira "*" (a tela a trata como "qualquer bloco")
  const porPrefixo = new Map();
  for (const [w, s] of indice) {
    const k = arqIndice(w);
    let m = porPrefixo.get(k); if (!m) porPrefixo.set(k, (m = {}));
    m[w] = s.size > blocos.length / 2 ? "*" : [...s].sort((a, b) => a - b);
  }
  const meta = {
    geradoEm: new Date().toISOString(), hoje, uf: UF, meses: MESES, de: corte,
    precos: precos.length, contratacoes: base.size, blocos: blocos.length, pendentes: fila,
    municipios, unidades, modalidades: MODALIDADES, prefixos: [...porPrefixo.keys()].sort(),
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
  for (const [k, m] of porPrefixo) gravarJson(join(dirW, "i", k + ".json.gz"), m);
  gravarJson(join(dirW, "meta.json"), meta);
  console.log(`Base: ${base.size} contratações (${novos} baixadas agora, ${podados} saíram por passar de ${MESES} meses), ${meta.precos} preços de ${meta.municipios.length} municípios, ${blocos.length} blocos; fila: ${fila.size}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
