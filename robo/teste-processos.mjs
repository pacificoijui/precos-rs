// Teste da base de processos da Região Sul, sem internet.
// node robo/teste-processos.mjs
import { registro, juntar, montarWeb, corte, UFS_SUL } from "./processos.mjs";
import { hojeISO } from "./comum.mjs";

let ok = 0, mau = 0;
const t = (n, c, e) => { if (c) { ok++; console.log("  ✓", n); } else { mau++; console.log("  ✗", n, e !== undefined ? JSON.stringify(e) : ""); process.exitCode = 1; } };
const hoje = "2026-09-30";

const compra = (o) => Object.assign({
  numeroControlePNCP: "88496468000160-1-000181/2026", anoCompra: 2026, sequencialCompra: 181, modalidadeId: 4, numeroCompra: "0004",
  processo: "178/2026", objetoCompra: "[Portal de Compras Públicas] - TERRAPLANAGEM   PARQUE DE RODEIOS",
  orgaoEntidade: { cnpj: "88496468000160", razaoSocial: "MUNICIPIO DE SANTA BARBARA DO SUL", esferaId: "M" },
  unidadeOrgao: { ufSigla: "RS", municipioNome: "Santa Bárbara do Sul", codigoIbge: "4316709", nomeUnidade: "PREFEITURA" },
  dataPublicacaoPncp: "2026-09-18T00:01:04", dataAberturaProposta: "2026-09-18T08:00:00", dataEncerramentoProposta: "2026-10-01T08:00:00",
  dataAtualizacaoGlobal: "2026-09-18T00:01:04", valorTotalEstimado: 327339.53, valorTotalHomologado: null, situacaoCompraId: 1, srp: false,
  linkSistemaOrigem: "https://pregaobanrisul.com.br/editais/0004_2026/356935", amparoLegal: { nome: "Lei 14.133/2021, Art. 28, II " },
}, o);

console.log("1) Registro enxuto");
const r = registro(compra());
t("campos da contratação", r.c === "88496468000160-1-000181/2026" && r.o === "88496468000160" && r.a === 2026 && r.s === 181 && r.m === 4 && r.n === "0004" && r.p === "178/2026");
t("objeto sem o prefixo do Portal de Compras e sem espaço sobrando", r.ob === "TERRAPLANAGEM PARQUE DE RODEIOS", r.ob);
t("datas só com o dia", r.pu === "2026-09-18" && r.ab === "2026-09-18" && r.en === "2026-10-01");
t("órgão, município, UF e esfera", r.or === "MUNICIPIO DE SANTA BARBARA DO SUL" && r.mu === "Santa Bárbara do Sul" && r.ib === "4316709" && r.uf === "RS" && r.es === "M");
t("valores e situação; o que está vazio não vai (arquivo menor)", r.ve === 327339.53 && !("vh" in r) && r.si === 1 && r.sr === 0 && r.am === "Lei 14.133/2021, Art. 28, II");

console.log("\n2) Atualização");
const m = new Map();
juntar(m, r);
juntar(m, registro(compra({ dataAtualizacaoGlobal: "2026-09-01T00:00:00", valorTotalHomologado: 1 })));
t("versão mais velha não apaga a nova", m.get(r.c).vh === undefined);
juntar(m, registro(compra({ dataAtualizacaoGlobal: "2026-10-05T00:00:00", valorTotalHomologado: 300000 })));
t("homologou depois: o valor homologado entra", m.get(r.c).vh === 300000 && m.size === 1);

console.log("\n3) O que a tela lê");
t("corte de 12 meses começa no dia 1º do mês", corte(hoje) === "2025-09-01", corte(hoje));
const velho = registro(compra({ numeroControlePNCP: "x-1-000001/2024", dataPublicacaoPncp: "2024-01-10T00:00:00" }));
const outro = registro(compra({ numeroControlePNCP: "y-1-000002/2026", dataPublicacaoPncp: "2026-08-02T00:00:00" }));
const sc = registro(compra({ numeroControlePNCP: "z-1-000003/2026", unidadeOrgao: { ufSigla: "SC", municipioNome: "Chapecó" } }));
const { meta, arquivos, estado } = montarWeb({ RS: [...m.values(), velho, outro], SC: [sc] }, { RS: { pendente: false }, SC: { pendente: true } }, hoje);
t("um arquivo por UF e mês de publicação", Object.keys(arquivos).sort().join() === "RS/2026-08.json.gz,RS/2026-09.json.gz,SC/2026-09.json.gz", Object.keys(arquivos));
t("o que passou de 12 meses sai da base e do estado", meta.ufs.RS.total === 2 && estado.RS.length === 2);
t("meta: total e meses de cada UF (mais recente primeiro), carga pendente", JSON.stringify(meta.ufs.RS.meses) === '{"2026-09":1,"2026-08":1}' && meta.ufs.SC.pendente === true && meta.ufs.PR.total === 0);
t("as três UFs da Região Sul", JSON.stringify(UFS_SUL) === '["RS","SC","PR"]' && Object.keys(meta.ufs).length === 3);
t("hojeISO no fuso de Brasília", /^\d{4}-\d{2}-\d{2}$/.test(hojeISO()));

console.log(`\n${ok} passaram, ${mau} falharam.`);
