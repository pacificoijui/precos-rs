// Processos da Região Sul (PR, SC e RS) publicados no PNCP — a base das
// camadas "Região Sul" e "Rio Grande do Sul" da tela do PNCP de Ijuí.
//
// Só a CONTRATAÇÃO (objeto, órgão, município, modalidade, datas, valores,
// situação); os itens a tela busca no PNCP na hora, quando alguém abre um
// processo. Todas as esferas (municipal, estadual, federal) e todas as
// modalidades, dos últimos MESES_PROC meses.
//
//   node robo/processos.mjs listar     (UF=RS)  lista e grava trab/proc-RS.json.gz
//   node robo/processos.mjs publicar            junta as UFs e monta proc-web/
//
// listar — carga inicial: mês a mês, pela data de publicação, cada
//          modalidade; o que não couber no tempo fica para a próxima rodada.
//          Depois: só o que mudou (data de atualização), com folga de 3 dias.
// publicar — tira o que passou de MESES_PROC meses e grava, por UF e mês de
//          publicação, proc-web/UF/AAAA-MM.json.gz, mais proc-web/meta.json.
import { join } from "node:path";
import { rmSync } from "node:fs";
import { CONSULTA, get, lerJson, gravarJson, hojeISO, menosMeses, maisDias, ymd, tempoAcabou, stats, minutos, dia } from "./comum.mjs";

const RAIZ = process.env.RAIZ || ".";
export const UFS_SUL = ["RS", "SC", "PR"];
export const MESES_PROC = +process.env.MESES_PROC || 12;
// Todas as modalidades do PNCP (1 e 13 são leilões; também entram: é processo)
export const MODS_PROC = [6, 8, 4, 9, 7, 5, 12, 1, 13, 3, 2, 10, 11];
const FORMATO = 1;

// Uma contratação do PNCP → o registro enxuto que vai para a tela
export function registro(c) {
  const o = c.orgaoEntidade || {}, u = c.unidadeOrgao || {};
  const r = {
    c: c.numeroControlePNCP, o: o.cnpj, a: c.anoCompra, s: c.sequencialCompra, m: c.modalidadeId,
    n: String(c.numeroCompra || "").split("|")[0].trim(), p: String(c.processo || "").trim(),
    ob: String(c.objetoCompra || "").replace(/^\[Portal de Compras Públicas\]\s*-\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 500),
    pu: dia(c.dataPublicacaoPncp), ab: dia(c.dataAberturaProposta), en: dia(c.dataEncerramentoProposta),
    at: c.dataAtualizacaoGlobal || c.dataAtualizacao || "",
    uf: u.ufSigla || "", mu: u.municipioNome || "", ib: u.codigoIbge || "", or: o.razaoSocial || "", un: u.nomeUnidade || "",
    es: o.esferaId || "", ve: c.valorTotalEstimado ?? null, vh: c.valorTotalHomologado ?? null,
    si: c.situacaoCompraId || null, sr: c.srp ? 1 : 0, li: c.linkSistemaOrigem || "", am: (c.amparoLegal && c.amparoLegal.nome || "").trim(),
    di: c.modoDisputaNome || "",
  };
  for (const k of Object.keys(r)) if (r[k] === "" || r[k] === null || r[k] === undefined) delete r[k];
  return r;
}
// O registro novo substitui o antigo só se for mais recente (ou igual)
export function juntar(mapa, r) {
  const v = mapa.get(r.c);
  if (!v || (r.at || "") >= (v.at || "")) mapa.set(r.c, r);
}
export const corte = (hoje, meses = MESES_PROC) => menosMeses(hoje, meses).slice(0, 7) + "-01";

async function paginas(tipo, uf, mod, di, df, mapa) {
  let lidas = 0;
  for (let pag = 1; ; pag++) {
    const u = `${CONSULTA}/contratacoes/${tipo}?dataInicial=${ymd(di)}&dataFinal=${ymd(df)}&codigoModalidadeContratacao=${mod}&uf=${uf}&pagina=${pag}&tamanhoPagina=50`;
    const r = await get(u);
    const dados = (r && r.data) || [];
    lidas += dados.length;
    for (const c of dados) { const x = registro(c); if (x.c && (!x.uf || x.uf === uf)) juntar(mapa, x); }
    if (!r || pag >= (r.totalPaginas || 1) || !dados.length) break;
  }
  return lidas;
}

async function listar() {
  const uf = process.env.UF;
  if (!UFS_SUL.includes(uf)) throw new Error("Informe UF (RS, SC ou PR).");
  const hoje = hojeISO(), ini = corte(hoje);
  const mapa = new Map((lerJson(join(RAIZ, "proc-estado", `${uf}.json.gz`), [])).map((r) => [r.c, r]));
  const cursor = lerJson(join(RAIZ, "proc-estado", `cursor-${uf}.json`), { mods: {} });
  const antes = mapa.size;
  let ultimoSalvo = Date.now();
  const salvar = () => {
    gravarJson(join(RAIZ, "trab", `proc-${uf}.json.gz`), [...mapa.values()]);
    gravarJson(join(RAIZ, "trab", `cursor-${uf}.json`), cursor, { bonito: true });
    ultimoSalvo = Date.now();
  };
  for (const mod of MODS_PROC) {
    const cm = cursor.mods[mod] = cursor.mods[mod] || {};
    if (!cm.feita) {
      let de = cm.proximo && cm.proximo >= ini ? cm.proximo : ini;
      while (de <= hoje && !tempoAcabou()) {
        let ate = maisDias(menosMeses(de, -1), -1); if (ate > hoje) ate = hoje;
        try {
          const n = await paginas("publicacao", uf, mod, de, ate, mapa);
          console.log(`[${uf} mod ${mod}] ${de} a ${ate}: ${n} (${mapa.size} no total, ${minutos()} min, ${stats.chamadas} chamadas, ${stats.erros429}×429)`);
        } catch (e) { console.log(`[${uf} mod ${mod}] falhou em ${de}: ${e.message} — a próxima rodada tenta de novo`); break; }
        de = maisDias(ate, 1); cm.proximo = de;
        if (Date.now() - ultimoSalvo > 10 * 60_000) salvar();
      }
      if (de > hoje) { cm.feita = true; cm.listadoAte = hoje; }
    } else {
      // dia a dia: o que mudou desde a última listagem (situação, homologação…)
      let de = maisDias(cm.listadoAte || hoje, -3), ok = true;
      while (de <= hoje && !tempoAcabou()) {
        let ate = maisDias(de, 29); if (ate > hoje) ate = hoje;
        try { const n = await paginas("atualizacao", uf, mod, de, ate, mapa); console.log(`[${uf} mod ${mod}] atualizadas ${de} a ${ate}: ${n}`); }
        catch (e) { console.log(`[${uf} mod ${mod}] falhou: ${e.message}`); ok = false; break; }
        de = maisDias(ate, 1);
      }
      if (ok && de > hoje) cm.listadoAte = hoje;
    }
    if (tempoAcabou()) { console.log(`[${uf}] tempo acabou: o resto fica para a próxima rodada`); break; }
  }
  cursor.pendente = MODS_PROC.some((m) => !(cursor.mods[m] && cursor.mods[m].feita));
  salvar();
  console.log(`[${uf}] fim: ${mapa.size} contratações (${mapa.size - antes >= 0 ? "+" : ""}${mapa.size - antes}); ${stats.chamadas} chamadas, ${stats.erros429}×429, ${minutos()} min${cursor.pendente ? " — carga inicial continua na próxima rodada" : ""}`);
}

// Agrupa por mês de publicação e monta o que a tela lê
export function montarWeb(porUf, cursores, hoje = hojeISO()) {
  const ini = corte(hoje), arquivos = {}, meta = { formato: FORMATO, geradoEm: new Date().toISOString(), desde: ini, meses: MESES_PROC, ufs: {} };
  for (const uf of UFS_SUL) {
    const lista = (porUf[uf] || []).filter((r) => r.pu && r.pu >= ini).sort((a, b) => (b.pu + b.c < a.pu + a.c ? -1 : 1));
    const meses = {};
    for (const r of lista) (meses[r.pu.slice(0, 7)] = meses[r.pu.slice(0, 7)] || []).push(r);
    for (const [m, rs] of Object.entries(meses)) arquivos[`${uf}/${m}.json.gz`] = rs;
    meta.ufs[uf] = {
      total: lista.length, pendente: !!(cursores[uf] && cursores[uf].pendente),
      meses: Object.fromEntries(Object.keys(meses).sort().reverse().map((m) => [m, meses[m].length])),
    };
  }
  return { meta, arquivos, estado: Object.fromEntries(UFS_SUL.map((uf) => [uf, (porUf[uf] || []).filter((r) => r.pu && r.pu >= ini)])) };
}

function publicar() {
  const porUf = {}, cursores = {};
  for (const uf of UFS_SUL) {
    // o que a rodada listou; se a máquina daquela UF falhou, fica o estado anterior
    porUf[uf] = lerJson(join(RAIZ, "trab", `proc-${uf}.json.gz`), null) || lerJson(join(RAIZ, "proc-estado", `${uf}.json.gz`), []);
    cursores[uf] = lerJson(join(RAIZ, "trab", `cursor-${uf}.json`), null) || lerJson(join(RAIZ, "proc-estado", `cursor-${uf}.json`), { mods: {}, pendente: true });
  }
  const { meta, arquivos, estado } = montarWeb(porUf, cursores);
  rmSync(join(RAIZ, "proc-web"), { recursive: true, force: true });
  for (const [arq, rs] of Object.entries(arquivos)) gravarJson(join(RAIZ, "proc-web", arq), rs);
  gravarJson(join(RAIZ, "proc-web", "meta.json"), meta, { bonito: true });
  for (const uf of UFS_SUL) {
    gravarJson(join(RAIZ, "proc-estado", `${uf}.json.gz`), estado[uf]);
    gravarJson(join(RAIZ, "proc-estado", `cursor-${uf}.json`), cursores[uf], { bonito: true });
  }
  console.log("Publicado: " + UFS_SUL.map((uf) => `${uf} ${meta.ufs[uf].total}${meta.ufs[uf].pendente ? " (carga em andamento)" : ""}`).join(" · "));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  (cmd === "listar" ? listar() : cmd === "publicar" ? Promise.resolve(publicar()) : Promise.reject(new Error("uso: processos.mjs listar|publicar")))
    .catch((e) => { console.error(e); process.exit(1); });
}
