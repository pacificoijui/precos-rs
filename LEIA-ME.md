# Preços dos municípios do RS (PNCP)

Base de **preços homologados** de todos os órgãos municipais do Rio Grande do
Sul (prefeituras, câmaras, autarquias, fundos) publicados no **PNCP — Portal
Nacional de Contratações Públicas**, dos **últimos 24 meses**. É a base
estadual da Pesquisa de Preços do Município de Ijuí (Lei 14.133/2021, art. 23,
§ 1º, II — contratações similares feitas pela Administração Pública).

Só dados que o próprio PNCP já publica. CPF de fornecedor pessoa física sai
mascarado (`***.456.789-**`), como no site do PNCP.

## Como funciona

O robô (`.github/workflows/robo.yml`) roda todo dia às 04:15 (Brasília):

1. **listar** (uma máquina por modalidade): pergunta ao PNCP o que é novo ou
   mudou. Na carga inicial, lê os 24 meses mês a mês.
2. **baixar** (16 máquinas em paralelo): itens e resultados de cada
   contratação da fila. O PNCP limita requisições por endereço; com 16
   máquinas a carga inicial termina em poucas rodadas (a cada 4 h enquanto
   houver fila).
3. **publicar**: junta tudo, **tira o que passou de 24 meses** e monta a
   base no ramo `dados`, sempre num commit só (a base muda todo dia e o
   histórico não precisa guardar cada versão).

## O que fica no ramo `dados`

| | |
|---|---|
| `web/meta.json` | resumo: total de preços, municípios, período, unidades, fila pendente, arquivos do índice |
| `web/b/N.json.gz` | blocos de ~1.000 preços em ordem de descrição |
| `web/i/XXX.json.gz` | índice: palavra → linhas em que aparece (a primeira, depois as distâncias), por prefixo de 3 letras; palavra de 2 letras no arquivo de 2. `con`, `prn`, `aux` e `nul` ganham `_` no nome (proibidos no Windows) |
| `estado/` | o que o robô precisa para continuar (contratações baixadas, fila, cursor) |

A tela lê direto de `https://raw.githubusercontent.com/pacificoijui/precos-rs/dados/web/`:
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
MOD=6 node robo/listar.mjs                        # lista pregões eletrônicos
PARTE=0 PARTES=1 node robo/baixar.mjs             # baixa a fila
node robo/publicar.mjs                            # monta estado/ e web/
```

Variáveis: `MESES` (24), `UF` (RS), `ORCAMENTO_MIN` (minutos por rodada),
`SIMULTANEAS` e `INTERVALO_MS` (ritmo das chamadas ao PNCP).

## Processos da Região Sul (ramo `processos`)

Um segundo robô (`.github/workflows/processos.yml`, `robo/processos.mjs`)
monta a base de **processos** — as contratações, sem itens — de **PR, SC e
RS**, de todas as esferas e modalidades, dos **últimos 12 meses**. É o que a
tela do PNCP de Ijuí lê nas camadas **Região Sul** e **Rio Grande do Sul**
(Ijuí continua com a base própria, com itens e vencedores). Os itens de um
processo de outro órgão a tela busca no PNCP na hora, quando alguém o abre.

Roda todo dia às 03:40 (e a cada 4 h enquanto a carga inicial não termina),
com uma máquina por UF. Grava no ramo `processos`, num commit só:

| | |
|---|---|
| `web/meta.json` | por UF: total, carga pendente e quantos processos em cada mês |
| `web/UF/AAAA-MM.json.gz` | os processos publicados naquele mês, mais recentes primeiro |
| `estado/` | o que o robô precisa para continuar (todas as contratações e o cursor de cada modalidade) |

Registro: `c` controle PNCP, `o` CNPJ do órgão, `a` ano, `s` sequencial,
`m` modalidade, `n` nº, `p` processo, `ob` objeto, `pu`/`ab`/`en` publicação,
abertura e encerramento, `uf`, `mu` município, `ib` IBGE, `or` órgão, `un`
unidade, `es` esfera, `ve`/`vh` estimado e homologado, `si` situação (1
divulgada, 2 revogada, 3 anulada, 4 suspensa), `sr` registro de preços, `li`
link do sistema de origem, `am` amparo legal, `di` modo de disputa.

```bash
node robo/teste-processos.mjs          # teste sem internet
UF=RS node robo/processos.mjs listar   # lista o RS (grava trab/)
node robo/processos.mjs publicar       # monta proc-web/ e proc-estado/
```
