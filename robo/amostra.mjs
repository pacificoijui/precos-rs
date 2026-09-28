// Amostra da base para os testes da Pesquisa de Preços (repositório ijui,
// testes/fixtures/precos-rs): as contratações de Ijuí do PNCP (o
// pncp/dados/licitacoes.js de lá) mais duas cópias com outro município e
// preços um pouco diferentes, montadas pelo mesmo montarWeb da base de verdade.
//
//   node robo/amostra.mjs ../ijui/pncp/dados/licitacoes.js ../ijui/testes/fixtures/precos-rs
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { gravarJson, hojeISO, menosMeses, MESES } from "./comum.mjs";
import { montarWeb } from "./publicar.mjs";

const [origem, saida] = process.argv.slice(2);
if (!origem || !saida) { console.error("uso: node robo/amostra.mjs <licitacoes.js> <pasta de saída>"); process.exit(1); }

const ctx = { window: {} };
vm.runInNewContext(readFileSync(origem, "utf8"), ctx);
const L = ctx.window.LICITACON;
// Uma parte das contratações basta (AMOSTRA, padrão 600): as que têm os
// itens que os testes buscam e, das outras, uma a cada tantas
const BUSCADOS = /caix|agua|pneu|papel|arroz|oleo|tinta|luva|cimento/i;
const comPreco = L.processos.filter((p) => (p.itens || []).some((i) => (i.res || []).some((r) => r.vlUnit > 0)));
const fixos = comPreco.filter((p) => p.itens.some((i) => BUSCADOS.test(i.desc)));
const passo = Math.max(1, Math.ceil((comPreco.length - fixos.length) / Math.max(1, (+process.env.AMOSTRA || 600) - fixos.length)));
const escolhidos = new Set([...fixos, ...comPreco.filter((p, k) => k % passo === 0)]);
L.processos = comPreco.filter((p) => escolhidos.has(p));
const nomes = ["Ijuí", "Município Teste 1", "Município Teste 2"];
const base = new Map();
nomes.forEach((mun, mi) => {
  // Ijuí fica com os preços de verdade (a tela reconhece o mesmo preço nas
  // duas bases); os outros, com uma variação fixa por município
  const f = mi ? 1 + ((mi * 7919) % 41 - 20) / 100 : 1;
  for (const p of L.processos) {
    const it = (p.itens || []).map((i) => [i.n, i.desc, i.un, i.tipo, i.qtd,
      (i.res || []).filter((r) => r.vlUnit > 0).map((r) => [r.fornecedor, r.doc, r.qtd, Math.round(r.vlUnit * f * 100) / 100, r.data])])
      .filter((i) => i[5].length);
    if (!it.length) continue;
    const c = p.controle + (mi ? "-" + mi : "");
    base.set(c, { c, o: L.cnpj, a: p.ano, s: p.seq, at: p.atualizacao, mod: p.modalidadeId, num: p.numero,
      pub: p.publicacao, ab: p.abertura, mun, org: mi ? "MUNICIPIO DE " + mun.toUpperCase() : L.orgao, it });
  }
});
const hoje = hojeISO();
const { meta, blocos, porPrefixo } = montarWeb(base, { corte: menosMeses(hoje, MESES), hoje, porBloco: +process.env.POR_BLOCO || 400 });
if (existsSync(saida)) rmSync(saida, { recursive: true });
blocos.forEach((b, i) => gravarJson(join(saida, "b", i + ".json.gz"), b));
for (const [k, m] of porPrefixo) gravarJson(join(saida, "i", k + ".json.gz"), m);
gravarJson(join(saida, "meta.json"), meta);
console.log(`${base.size} contratações, ${meta.precos} preços, ${blocos.length} blocos, ${porPrefixo.size} arquivos de índice, municípios: ${meta.municipios.join(", ")}`);
