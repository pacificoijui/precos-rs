// Teste do robô, sem internet: respostas do PNCP simuladas.
// node robo/teste.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gravarJson, gravarLinhas, lerJson, hojeISO, menosMeses, idPreco, normUnidade, mascararDoc, limparNome, parteDe } from "./comum.mjs";
import { serve, entradaDaFila } from "./listar.mjs";
import { baixarContratacao, filaCompleta } from "./baixar.mjs";
import { juntarEstado, montarWeb, palavras } from "./publicar.mjs";

let ok = 0, mau = 0;
const t = (n, c, e) => { if (c) { ok++; console.log("  ✓", n); } else { mau++; console.log("  ✗", n, e !== undefined ? JSON.stringify(e) : ""); process.exitCode = 1; } };
const hoje = hojeISO();

console.log("1) Normalizações");
t("unidades: KG, Quilo e Quilogramas viram quilograma", ["KG", "Quilo", "Quilogramas"].every((u) => normUnidade(u) === "quilograma"));
t("UN, Und e Unidade viram unidade", ["UN", "Und", "Unidade"].every((u) => normUnidade(u) === "unidade"));
t("a sigla entre parênteses sai: 'Ampola (amp)', 'KG (kg)', 'Unidade (UN)'", normUnidade("Ampola (amp)") === "ampola" && normUnidade("KG (kg)") === "quilograma" && normUnidade("Unidade (UN)") === "unidade");
t("unidade que é só parênteses fica como está", normUnidade("(40)") === "(40)");
t("CPF de pessoa física sai mascarado", mascararDoc("12345678901") === "***.456.789-**");
t("CNPJ fica inteiro", mascararDoc("12.345.678/0001-90") === "12345678000190");
t("nome de MEI perde o CPF colado", limparNome("FABIO DA LUZ PEREIRA 94907382049") === "FABIO DA LUZ PEREIRA");
t("id de preço estável e acima dos ids de Ijuí", idPreco("x#1#0") === idPreco("x#1#0") && idPreco("x#1#0") > 2 ** 40 && idPreco("x#1#0") < 2 ** 53);
t("palavras: sem acento e sem as vazias", JSON.stringify(palavras("Arroz tipo 1, pacote de 5 kg")) === JSON.stringify(["arroz", "pacote", "kg"]));

console.log("\n2) O que entra na fila");
const compra = (o) => Object.assign({
  numeroControlePNCP: "111-1-000001/2026", anoCompra: 2026, sequencialCompra: 1, modalidadeId: 6, numeroCompra: "10",
  orgaoEntidade: { cnpj: "11111111000111", esferaId: "M", razaoSocial: "MUNICIPIO DE TESTE" },
  unidadeOrgao: { ufSigla: "RS", municipioNome: "Teste", codigoIbge: "4300000" },
  dataAtualizacaoGlobal: "2026-05-02T10:00:00", dataEncerramentoProposta: "2026-05-01T09:00:00", dataPublicacaoPncp: "2026-04-10T00:00:00",
  objetoCompra: "[Portal de Compras Públicas] - Aquisição de arroz",
}, o);
t("municipal do RS, encerrada e nova: entra", serve(compra(), {}, hoje));
t("estadual/federal: não entra", !serve(compra({ orgaoEntidade: { esferaId: "E" } }), {}, hoje));
t("de outro estado: não entra", !serve(compra({ unidadeOrgao: { ufSigla: "SC" } }), {}, hoje));
t("propostas ainda abertas: não entra (não tem preço ainda)", !serve(compra({ dataEncerramentoProposta: "2999-01-01T00:00:00" }), {}, hoje));
t("já baixada e sem mudança: não entra", !serve(compra(), { "111-1-000001/2026": "2026-05-02T10:00:00" }, hoje));
t("baixada mas mudou no PNCP: entra de novo", serve(compra({ dataAtualizacaoGlobal: "2026-06-01T00:00:00" }), { "111-1-000001/2026": "2026-05-02T10:00:00" }, hoje));
const e = entradaDaFila(compra());
t("a entrada guarda o necessário (órgão, ano, sequencial, município)", e.o === "11111111000111" && e.a === 2026 && e.s === 1 && e.mun === "Teste" && e.obj === "Aquisição de arroz");

console.log("\n3) Baixar uma contratação (PNCP simulado)");
const respostas = {
  "/itens?pagina=1": [
    { numeroItem: 1, descricao: "Arroz  parboilizado 5kg", unidadeMedida: "Pacote", materialOuServico: "M", quantidade: 100, temResultado: true },
    { numeroItem: 2, descricao: "Feijão", unidadeMedida: "KG", quantidade: 50, temResultado: false },
    { numeroItem: 3, descricao: "Açúcar", unidadeMedida: "KG", quantidade: 50, temResultado: true },
  ],
  "/itens/1/resultados": [
    { nomeRazaoSocialFornecedor: "MERCADO A LTDA", niFornecedor: "12345678000190", quantidadeHomologada: 100, valorUnitarioHomologado: 21.4, dataResultado: "2026-05-10T00:00:00" },
    { nomeRazaoSocialFornecedor: "FULANO 12345678901", niFornecedor: "12345678901", quantidadeHomologada: 10, valorUnitarioHomologado: 20, dataResultado: "2026-05-10" },
  ],
  "/itens/3/resultados": [{ nomeRazaoSocialFornecedor: "X", niFornecedor: "1", valorUnitarioHomologado: 0, situacaoCompraItemResultadoNome: "Informado" }],
};
const chamadas = [];
const obter = async (u) => { chamadas.push(u); const k = Object.keys(respostas).find((k) => u.includes(k)); return k ? respostas[k] : null; };
const r = await baixarContratacao(e, obter);
t("só itens com preço homologado > 0 ficam", r.it.length === 1 && r.it[0][0] === 1, r.it);
t("resultados do item: dois fornecedores", r.it[0][5].length === 2);
t("CPF mascarado e nome limpo", r.it[0][5][1][0] === "FULANO" && r.it[0][5][1][1] === "***.456.789-**", r.it[0][5][1]);
t("não pede resultado de item sem resultado", !chamadas.some((u) => u.includes("/itens/2/")));

console.log("\n4) Juntar ao estado, tirar o velho e montar a base");
const raiz = mkdtempSync(join(tmpdir(), "precos-"));
try {
  const velho = { c: "velho", o: "2", a: 2020, s: 1, at: "a", mod: 6, num: "1", pub: "2020-01-01", mun: "Antiga", it: [[1, "Arroz velho", "KG", "M", 1, [["F", "1", 1, 3, "2020-01-10"]]]] };
  const ok1 = { c: "ok1", o: "3", a: 2026, s: 2, at: "b", mod: 8, num: "5", pub: menosMeses(hoje, 1), mun: "Nova", org: "MUNICIPIO DE NOVA", it: [[1, "Arroz tipo 1", "kg", "M", 1, [["G", "2", 1, 4.5, menosMeses(hoje, 1)]]]] };
  gravarLinhas(join(raiz, "estado", "p", "00.ndjson.gz"), [velho, ok1]);
  gravarJson(join(raiz, "estado", "fila.json.gz"), [Object.assign({}, e, { c: "fila1", at: "x" }), Object.assign({}, e, { c: "111-1-000001/2026" })]);
  gravarJson(join(raiz, "trab", "lista-6.json"), { mod: 6, cursor: { feita: true, listadoAte: hoje }, fila: [Object.assign({}, e, { c: "fila2", at: "y" })] });
  gravarLinhas(join(raiz, "trab", "baixado-0.ndjson.gz"), [r]);
  t("a fila das partes junta a anterior e a nova", filaCompleta(raiz).size === 3);
  const j = juntarEstado(raiz, hoje);
  t("o que passou de 24 meses sai", !j.base.has("velho") && j.podados === 1);
  t("o baixado agora entra, o recente fica", j.base.has("111-1-000001/2026") && j.base.has("ok1"));
  t("o que foi baixado sai da fila; o resto fica", !j.fila.has("111-1-000001/2026") && j.fila.has("fila1") && j.fila.has("fila2"));
  t("o cursor da modalidade é guardado", j.cursor.carga[6] && j.cursor.carga[6].feita);
  t("vistos guarda a data de atualização baixada", j.vistos["111-1-000001/2026"] === e.at);
  const w = montarWeb(j.base, { corte: j.corte, hoje, fila: j.fila.size });
  t("meta: 3 preços, 2 municípios, pendentes = fila", w.meta.precos === 3 && w.meta.municipios.length === 2 && w.meta.pendentes === 2, w.meta);
  const idxAr = w.porPrefixo.get("arr");
  t("índice por três letras: 'arroz' está em i/arr", idxAr && idxAr.arroz && !w.porPrefixo.has("ar"));
  t("índice: 'arroz' dá as linhas em que aparece (primeira e distâncias)", JSON.stringify(idxAr.arroz) === "[0,1,1]", idxAr.arroz);
  t("meta: formato 2 e a lista de arquivos do índice agrupada", w.meta.formato === 2 && /r/.test(w.meta.prefixos.ar) && !/\./.test(w.meta.prefixos.ar), w.meta.prefixos);
  const it = (n, d) => [n, d, "UN", "M", 1, [["F", "1", 1, 10 + n, hoje], ["G", "2", 1, 11 + n, hoje]]];
  const pc = montarWeb(new Map([["x", { c: "x", o: "1", a: 2026, s: 1, mod: 6, num: "1", mun: "Nova",
    it: [it(1, "Papel A4 75g"), it(2, "Papel A4 90g"), it(3, "Caneta azul"), it(4, "Caneta preta"), it(5, "Clips")] }]]), { corte: j.corte, hoje, porBloco: 2 });
  t("blocos do tamanho pedido, em ordem de descrição", pc.blocos.length === 5 && pc.blocos[0].r.every((r) => /Caneta azul/.test(r[1])), pc.blocos.map((b) => b.r.map((r) => r[1])));
  t("índice com as linhas: 'papel' = linhas 6, 7, 8 e 9", JSON.stringify(pc.porPrefixo.get("pap").papel) === "[6,1,1,1]", pc.porPrefixo.get("pap"));
  t("palavra de duas letras fica no arquivo de duas ('a4' em i/a4)", JSON.stringify(pc.porPrefixo.get("a4").a4) === "[6,1,1,1]" && pc.meta.prefixos.a4 === ".", pc.meta.prefixos);
  t("meta diz quantos preços por bloco", pc.meta.porBloco === 2);
  t("meta diz onde cada bloco começa (para achar os itens que começam com a palavra)", JSON.stringify(pc.meta.inicios) === JSON.stringify(["caneta azul", "caneta preta", "clips", "papel a4 75g", "papel a4 90g"]), pc.meta.inicios);
  const num = montarWeb(new Map([["x", { c: "x", o: "1", a: 2026, s: 1, mod: 6, num: "1", mun: "Nova",
    it: [it(1, "Leite integral"), it(2, "1 - Leite desnatado"), it(3, "Açúcar"), it(4, "Requeijão com leite")] }]]), { corte: j.corte, hoje, porBloco: 2 });
  t("'1 - Leite' fica junto com 'Leite' (a numeração não conta na ordem)", JSON.stringify(num.meta.inicios) === JSON.stringify(["acucar", "leite desnatado", "leite integral", "requeijao com leite"]), num.meta.inicios);
  const comum = montarWeb(new Map([["x", { c: "x", o: "1", a: 2026, s: 1, mod: 6, num: "1", mun: "Nova",
    it: [it(1, "Papel A4 75g"), it(2, "Papel A4 90g"), it(3, "Caneta azul"), it(4, "Caneta preta"), it(5, "Clips")] }]]), { corte: j.corte, hoje, porBloco: 2, limiteLinhas: 3 });
  t("palavra comum demais guarda só blocos e contagens", JSON.stringify(comum.porPrefixo.get("pap").papel) === JSON.stringify({ b: [3, 2, 4, 2] }) && JSON.stringify(comum.porPrefixo.get("cli").clips) === "[4,1]", [comum.porPrefixo.get("pap"), comum.porPrefixo.get("cli")]);
  const linha = w.blocos[0].r[0], proc = w.blocos[0].p[linha[6]];
  t("linha do bloco: id, descrição, unidade, valor, data, processo e fornecedor", typeof linha[0] === "number" && linha[1] && w.meta.unidades[linha[2]] && linha[3] > 0 && /^\d{4}-\d\d-\d\d$/.test(linha[5]) && proc.length === 7 && w.blocos[0].f[linha[7]]);
  t("ordem por descrição (itens parecidos juntos)", w.blocos[0].r.map((x) => x[1].toLowerCase()).join("|") === w.blocos[0].r.map((x) => x[1].toLowerCase()).sort().join("|"));
  t("parte de uma contratação é sempre a mesma", parteDe("abc", 8) === parteDe("abc", 8));
} finally { rmSync(raiz, { recursive: true, force: true }); }

console.log(`\n${ok} passaram, ${mau} falharam.`);
