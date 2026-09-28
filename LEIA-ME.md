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
| `web/i/XXX.json.gz` | índice: palavra → `[bloco, quantos preços do bloco têm a palavra, …]` (por prefixo de 3 letras; palavra de 2 letras no arquivo de 2) |
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
