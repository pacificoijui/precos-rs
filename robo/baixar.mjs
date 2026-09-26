// 2ª etapa: baixa itens e resultados das contratações da fila. O workflow
// roda várias partes ao mesmo tempo (cada máquina do GitHub tem o seu
// endereço, e o limite de requisições do PNCP é por endereço).
//
// Só interessa o que tem preço: item com resultado homologado e valor > 0.
// Contratação sem nenhum preço também é gravada (vazia), para não ser
// baixada de novo enquanto não mudar no PNCP.
//
// Uso: PARTE=0 PARTES=8 node robo/baixar.mjs   (grava trab/baixado-0.ndjson.gz)
import { join } from "node:path";
import {
  API, get, lerJson, gravarLinhas, arquivos, parteDe, emParalelo, tempoAcabou, stats, minutos, num, dia,
  mascararDoc, limparNome,
} from "./comum.mjs";

const RAIZ = process.env.RAIZ || ".";
const PARTE = +process.env.PARTE || 0, PARTES = +process.env.PARTES || 1;
const PARALELO = +process.env.PARALELO || 6;

export function filaCompleta(raiz) {
  const fila = new Map();
  for (const e of lerJson(join(raiz, "estado", "fila.json.gz"), [])) fila.set(e.c, e);
  for (const arq of arquivos(join(raiz, "trab"), /^lista-\d+\.json$/)) {
    for (const e of lerJson(arq, { fila: [] }).fila) fila.set(e.c, e);
  }
  return fila;
}

class SemTempo extends Error {}
export async function baixarContratacao(e, obter = get) {
  const base = `${API}/orgaos/${e.o}/compras/${e.a}/${e.s}`;
  const itens = new Map();
  for (let pag = 1; pag < 100; pag++) {
    const r = await obter(`${base}/itens?pagina=${pag}&tamanhoPagina=500`);
    const lista = Array.isArray(r) ? r : (r && r.data) || [];
    let novos = 0;
    lista.forEach((it) => { if (!itens.has(it.numeroItem)) { itens.set(it.numeroItem, it); novos++; } });
    if (!novos || lista.length < 500) break;
  }
  const comRes = [...itens.values()].filter((it) => it.temResultado).sort((a, b) => a.numeroItem - b.numeroItem);
  const it = [];
  for (const i of comRes) {
    if (tempoAcabou()) throw new SemTempo();
    const r = await obter(`${base}/itens/${i.numeroItem}/resultados`);
    const res = (Array.isArray(r) ? r : (r && r.data) || [])
      .filter((x) => num(x.valorUnitarioHomologado) > 0 && !/cancelad|anulad|revogad/i.test(x.situacaoCompraItemResultadoNome || ""))
      .map((x) => [
        limparNome(x.nomeRazaoSocialFornecedor), mascararDoc(x.niFornecedor),
        num(x.quantidadeHomologada), num(x.valorUnitarioHomologado), dia(x.dataResultado || x.dataInclusao),
      ]);
    if (res.length) it.push([i.numeroItem, String(i.descricao || "").replace(/\s+/g, " ").trim(), String(i.unidadeMedida || "").trim(), i.materialOuServico || "", num(i.quantidade), res]);
  }
  return Object.assign({}, e, { it });
}

async function main() {
  const fila = [...filaCompleta(RAIZ).values()].filter((e) => parteDe(e.c, PARTES) === PARTE)
    // o mais novo primeiro: é o preço mais útil, e o que sobrar fica para depois
    .sort((a, b) => String(b.pub || "").localeCompare(String(a.pub || "")));
  console.log(`[parte ${PARTE}/${PARTES}] ${fila.length} contratações na fila`);
  const feitos = [];
  let precos = 0, falhas = 0;
  const saida = join(RAIZ, "trab", `baixado-${PARTE}.ndjson.gz`);
  let ultimaGravacao = Date.now();
  await emParalelo(fila, PARALELO, async (e) => {
    if (tempoAcabou()) return;
    try {
      const r = await baixarContratacao(e);
      feitos.push(r);
      precos += r.it.reduce((s, i) => s + i[5].length, 0);
    } catch (err) {
      if (!(err instanceof SemTempo)) { falhas++; if (falhas <= 20) console.log("  falhou:", e.c, err.message); }
    }
    if (feitos.length % 200 === 0) console.log(`  ${feitos.length}/${fila.length} contratações, ${precos} preços (${minutos()} min, ${stats.chamadas} chamadas, ${stats.erros429}×429)`);
    // ponto de salvamento a cada 10 min: se a máquina cair, não perde tudo
    if (Date.now() - ultimaGravacao > 600_000) { ultimaGravacao = Date.now(); gravarLinhas(saida, feitos); }
  });
  gravarLinhas(saida, feitos);
  console.log(`[parte ${PARTE}] fim: ${feitos.length} de ${fila.length} contratações, ${precos} preços, ${falhas} falhas; ${stats.chamadas} chamadas, ${stats.erros429}×429, ${minutos()} min`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
