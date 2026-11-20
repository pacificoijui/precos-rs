# Preços dos municípios da Região Sul — RS, SC e PR (PNCP)

Base de **preços homologados** de todos os órgãos municipais do Rio Grande do
Sul, de Santa Catarina e do Paraná (prefeituras, câmaras, autarquias, fundos)
publicados no **PNCP — Portal Nacional de Contratações Públicas**, dos
**últimos 24 meses**. É a base da Pesquisa de Preços do Município de Ijuí
(Lei 14.133/2021, art. 23, § 1º, II — contratações similares feitas pela
Administração Pública): a camada **Região Sul** busca nas três UFs; a camada
**Rio Grande do Sul**, só na do RS.

Cada UF tem a sua base, num ramo próprio:

| UF | robô | ramo | roda (Brasília) |
|---|---|---|---|
| RS | `robo.yml` | `dados` | 08:15 (+ 10h45, 14h45, 18h45 enquanto houver carga) |
| SC | `robo-sc.yml` | `dados-sc` | 08:35 (+ 11h05, 15h05, 19h05 enquanto houver carga) |
| PR | `robo-pr.yml` | `dados-pr` | 08:55 (+ 11h25, 15h25, 19h25 enquanto houver carga) |

Os três chamam o mesmo robô (`robo-uf.yml`), mudando só a UF e o ramo.

Só dados que o próprio PNCP já publica. CPF de fornecedor pessoa física sai
mascarado (`***.456.789-**`), como no site do PNCP.

## Como funciona

O robô de cada UF (`.github/workflows/robo-uf.yml`) roda de dia — de madrugada o PNCP recusa as máquinas do GitHub:

1. **listar** (uma máquina por modalidade): pergunta ao PNCP o que é novo ou
   mudou. Na carga inicial, lê os 24 meses mês a mês.
2. **baixar** (16 máquinas em paralelo): itens e resultados de cada
   contratação da fila. O PNCP limita requisições por endereço; com 16
   máquinas a carga inicial termina em poucas rodadas (a cada 4 h enquanto
   houver fila).
3. **publicar**: junta tudo, **tira o que passou de 24 meses** e monta a
   base no ramo da UF, sempre num commit só (a base muda todo dia e o
   histórico não precisa guardar cada versão).

## O que fica no ramo de cada UF

| | |
|---|---|
| `web/meta.json` | resumo: total de preços, municípios, período, unidades, fila pendente, arquivos do índice |
| `web/b/N.json.gz` | blocos de ~1.000 preços em ordem de descrição |
| `web/i/XXX.json.gz` | índice: palavra → linhas em que aparece (a primeira, depois as distâncias), por prefixo de 3 letras; palavra de 2 letras no arquivo de 2. `con`, `prn`, `aux` e `nul` ganham `_` no nome (proibidos no Windows) |
| `estado/` | o que o robô precisa para continuar (contratações baixadas, fila, cursor) |

A tela lê direto de `https://raw.githubusercontent.com/pacificoijui/precos-rs/RAMO/web/`
(`dados`, `dados-sc`, `dados-pr`):
primeiro o índice das palavras buscadas, depois só os blocos que as contêm —
começando pelos que têm mais preços do item buscado, que já aparecem na tela
enquanto o resto chega.

Mudou o código do robô? O push remonta `web/` a partir do estado, sem baixar
nada do PNCP (o mesmo que Actions › Run workflow › "Só remontar a base").

Linha de um bloco: `[id, descrição, unidade, valor unitário, quantidade, data, processo, fornecedor]`,
com `processo` = `[cnpj do órgão, ano, sequencial, modalidade, número, município, órgão]` e
`fornecedor` = `[nome, CNPJ/CPF mascarado]` nas tabelas `p` e `f` do próprio bloco.

## Rodar à mão

```bash
node robo/teste.mjs                               # teste sem internet
MOD=6 node robo/listar.mjs                        # lista pregões eletrônicos (UF=SC para SC)
PARTE=0 PARTES=1 node robo/baixar.mjs             # baixa a fila
node robo/publicar.mjs                            # monta estado/ e web/
```

Variáveis: `MESES` (24), `UF` (RS, SC ou PR), `ORCAMENTO_MIN` (minutos por rodada),
`SIMULTANEAS` e `INTERVALO_MS` (ritmo das chamadas ao PNCP).

A base de processos da Região Sul (ramo `processos`) foi aposentada: o PNCP
de Ijuí mostra só Ijuí; a Região Sul e o RS ficam na Pesquisa de Preços.
