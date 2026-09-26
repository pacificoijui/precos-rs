// 1ª etapa: descobre QUAIS contratações do RS (esfera municipal) precisam
// ser baixadas. Roda uma vez por modalidade (em paralelo no workflow).
//
//   carga inicial — lê mês a mês, pela data de publicação, os últimos
//                   MESES meses; se o tempo acabar, a próxima rodada segue
//                   do mês onde parou;
//   dia a dia     — depois da carga, pergunta ao PNCP só o que mudou desde a
//                   última rodada (data de atualização), com folga de 3 dias.
//
// Entra na fila a contratação nova ou que mudou desde que foi baixada, e já
// com as propostas encerradas (antes disso não há preço homologado; quando o
// resultado sair, a data de atualização muda e ela volta por aqui).
//
// Uso: MOD=6 node robo/listar.mjs   (grava trab/lista-6.json)
import { join } from "node:path";
import {
  CONSULTA, UF, MESES, get, lerJson, gravarJson, hojeISO, menosMeses, maisDias, ymd, tempoAcabou, stats, minutos, dia,
} from "./comum.mjs";

const RAIZ = process.env.RAIZ || ".";
const MOD = +process.env.MOD;
const hoje = hojeISO();
let vistos = {}, carga = {};

export function entradaDaFila(c) {
  const u = c.unidadeOrgao || {}, o = c.orgaoEntidade || {};
  return {
    c: c.numeroControlePNCP, o: o.cnpj, a: c.anoCompra, s: c.sequencialCompra,
    at: c.dataAtualizacaoGlobal || c.dataAtualizacao || "",
    mod: c.modalidadeId, num: String(c.numeroCompra || "").split("|")[0].trim(), proc: String(c.processo || "").trim(),
    obj: String(c.objetoCompra || "").replace(/^\[Portal de Compras Públicas\]\s*-\s*/i, "").trim().slice(0, 300),
    pub: dia(c.dataPublicacaoPncp), enc: dia(c.dataEncerramentoProposta), ab: dia(c.dataAberturaProposta),
    mun: u.municipioNome || "", ibge: u.codigoIbge || "", org: o.razaoSocial || "", uni: u.nomeUnidade || "",
  };
}
// Serve para a fila? (municipal, do estado, já encerrada, nova ou mudada)
export function serve(c, vistos, hoje) {
  const o = c.orgaoEntidade || {}, u = c.unidadeOrgao || {};
  if (o.esferaId !== "M" || (u.ufSigla && u.ufSigla !== UF)) return false;
  const enc = dia(c.dataEncerramentoProposta);
  if (enc && enc > hoje) return false;
  const at = c.dataAtualizacaoGlobal || c.dataAtualizacao || "";
  return vistos[c.numeroControlePNCP] !== at;
}

async function listar(tipo, di, df, fila) {
  let lidas = 0;
  for (let pag = 1; ; pag++) {
    const u = `${CONSULTA}/contratacoes/${tipo}?dataInicial=${ymd(di)}&dataFinal=${ymd(df)}&codigoModalidadeContratacao=${MOD}&uf=${UF}&pagina=${pag}&tamanhoPagina=50`;
    const r = await get(u);
    const dados = (r && r.data) || [];
    lidas += dados.length;
    for (const c of dados) if (serve(c, vistos, hoje)) fila.set(c.numeroControlePNCP, entradaDaFila(c));
    if (!r || pag >= (r.totalPaginas || 1) || !dados.length) break;
  }
  return lidas;
}

async function main() {
  if (!MOD) throw new Error("Informe MOD (código da modalidade no PNCP).");
  const cursor = lerJson(join(RAIZ, "estado", "cursor.json"), {});
  vistos = lerJson(join(RAIZ, "estado", "vistos.json.gz"), {});
  carga = (cursor.carga || {})[MOD] || {};
  const fila = new Map();
  const novoCursor = { carga: Object.assign({}, carga) };
  // carga inicial, mês a mês
  if (!carga.feita) {
    let de = carga.proximo || menosMeses(hoje, MESES);
    while (de <= hoje && !tempoAcabou()) {
      let ate = maisDias(menosMeses(maisDias(de, 0), -1), -1);
      if (ate > hoje) ate = hoje;
      let n;
      try { n = await listar("publicacao", de, ate, fila); }
      catch (e) { console.log(`[mod ${MOD}] falhou em ${de}: ${e.message} — a próxima rodada tenta de novo`); break; }
      console.log(`[mod ${MOD}] ${de} a ${ate}: ${n} contratações do ${UF}; fila ${fila.size} (${minutos()} min, ${stats.chamadas} chamadas, ${stats.erros429}×429)`);
      de = maisDias(ate, 1);
      novoCursor.carga.proximo = de;
    }
    if (de > hoje) { novoCursor.carga.feita = true; novoCursor.carga.listadoAte = hoje; }
  }
  // dia a dia: o que mudou desde a última listagem
  if (carga.feita) {
    const desde = maisDias(carga.listadoAte || menosMeses(hoje, 1), -3);
    let ok = true;
    for (let de = desde; de <= hoje; ) {
      let ate = maisDias(de, 29); if (ate > hoje) ate = hoje;
      try {
        const n = await listar("atualizacao", de, ate, fila);
        console.log(`[mod ${MOD}] atualizadas de ${de} a ${ate}: ${n}; fila ${fila.size}`);
      } catch (e) { console.log(`[mod ${MOD}] falhou: ${e.message}`); ok = false; break; }
      de = maisDias(ate, 1);
    }
    if (ok) novoCursor.carga.listadoAte = hoje;
  }
  gravarJson(join(RAIZ, "trab", `lista-${MOD}.json`), { mod: MOD, cursor: novoCursor.carga, fila: [...fila.values()] });
  console.log(`[mod ${MOD}] fim: ${fila.size} na fila; ${stats.chamadas} chamadas, ${stats.erros429}×429, ${minutos()} min`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
