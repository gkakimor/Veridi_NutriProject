# Pacote de revisão de cadastros — migração de produção

Gera os arquivos Excel que a Veridi revisa **antes** da carga definitiva de
cadastros em produção (PROD-MASTER-MIGRATION-PACK-01). Não carrega nada: só lê o
corpus real e escreve planilhas.

```
00_MAPA_CHAVES_PRODUCAO.xlsx      uma linha por registro: chave legado → CHAVE_MIGRACAO
01_CLIENTES.xlsx
02_FORNECEDORES.xlsx
03_MATERIAS_PRIMAS.xlsx
04_EMBALAGENS_INSUMOS.xlsx
05_PRODUTOS_ACABADOS.xlsx         Produto ↔ Item de produto acabado, 1:1
06_PRECOS_REFERENCIA_MERCADO.xlsx referência pública — NÃO é custo real
07_FORNECEDOR_ITENS_PRECOS.xlsx   ofertas de fornecedor do legado
MANIFESTO_MIGRACAO.md
```

Cada arquivo tem as abas DADOS, DICIONARIO, VALORES_PERMITIDOS, PENDENCIAS e
ORIGEM (e LEGADO_NAO_IMPORTADO quando há informação real que não cabe na carga).

## Rodar

Ferramenta local — **não** é dependência da aplicação. Python 3.11+ e openpyxl
num ambiente próprio:

```bash
python -m venv "$TEMP/veridi-pack"
"$TEMP/veridi-pack/Scripts/pip" install -r scripts/veridi-migration-pack/requirements.txt
"$TEMP/veridi-pack/Scripts/python" scripts/veridi-migration-pack/gerar_pacote.py
"$TEMP/veridi-pack/Scripts/python" scripts/veridi-migration-pack/validar_pacote.py handoff/migracao-producao/revisao-02
"$TEMP/veridi-pack/Scripts/python" -m unittest discover -s scripts/veridi-migration-pack
```

- `--dados` (padrão `../.local-data/veridi`) e `--saida` (padrão
  `handoff/migracao-producao/revisao-<revisao>`) mudam as pastas.
- `--revisao` (padrão `02`) só numera o pacote: pasta padrão, manifesto e aba
  ORIGEM. Não muda dado nenhum — a `CHAVE_MIGRACAO` é a mesma em toda revisão.
- `--pesquisa-nova` aponta a pesquisa pública complementar (padrão
  `market-reference/pesquisa-publica-2026-09-11.tsv` dentro de `--dados`).
- `validar_pacote.py --devolucao` valida os arquivos já editados pela Veridi:
  as regras que dependem da decisão dela (STATUS × pendência, preço recalculado)
  viram aviso.
- `validar_pacote.py --referencia <pacote anterior>` compara duas revisões:
  chave que sumiu, chave nova, coluna que desapareceu e coluna obrigatória que
  virou opcional reprovam. Coluna nova opcional passa.
- `test_devolucao.py` roda os cenários de devolução do 02 (endereço vazio,
  parcial e completo; CEP e UF inválidos; chave alterada; status inválido) numa
  **cópia temporária** do workbook — o handoff nunca é tocado. Sem pacote
  gerado, esses testes são pulados; `VERIDI_PACOTE` e `VERIDI_PACOTE_REFERENCIA`
  apontam outras pastas.

Nada disso conecta em banco. A saída tem dado real de cliente e fornecedor e fica
fora do Git (`handoff/` e `.local-data/` estão no `.gitignore`).

## Fontes

Lidas: `csv/` (planilhas da Veridi extraídas em 16/08/2026, conferidas byte a
byte contra `veridi-dados-csv.zip`) e, de `market-reference/`, só as linhas
`PESQUISA_MERCADO` de `market-prices.csv` mais a pesquisa complementar.

Nunca lidas: `cargaExemplo/` (sintético), `out/` e `de-para/` (derivados de banco
DEV — códigos de outro ambiente), banco de qualquer ambiente, seed, E2E, golden
path. As linhas `OFERTA_FORNECEDOR` de `market-prices.csv` também ficam de fora:
foram montadas a partir de um banco DEV; a oferta do legado vem direto de
`precos_fornecedores.csv`.

## Regras que valem em todos os arquivos

- **CHAVE_MIGRACAO** (coluna vermelha, digitação recusada com o aviso "NÃO
  ALTERAR"; a aba não é protegida, para filtro e ordenação continuarem
  funcionando) deriva só do legado e é autoritativa: `CLI-LEG-0000`,
  `FOR-LEG-<NOME>`, `ITEM-LEG-0000` (a mesma para matéria-prima e embalagem),
  `PROD-LEG-<cód>` / `PA-LEG-<cód>`, `OFE-LEG-…` (chave de idempotência do
  importador), `REF-…`. Nunca UUID, nunca código interno do ERP.
- **CODIGO_PRODUCAO_PREVISTO = GERADO NA CARGA**: o código real sai da sequence
  no APPLY e depende da lista aprovada — prever seria inventar.
- **STATUS_REVISAO**: todo registro nasce `REVISAR`. Depois de conferir, a
  Veridi muda para `OK` (entra na carga), `PENDENTE` (falta resolver) ou
  `NAO_IMPORTAR` (fica fora; a linha não é apagada). Pendência com
  `IMPEDE_CARGA = SIM` precisa estar resolvida antes do `OK`.
- **Colunas = campos das telas do ERP** (Cliente, Fornecedor, Item, Produto,
  Item × Fornecedor), na ordem das seções. Campo sem dado no legado vem com o
  padrão do sistema ou vazio; só é obrigatório o que a tela exige.
- **Endereço** (Cliente e Fornecedor): `CEP`, `LOGRADOURO`, `NUMERO`,
  `COMPLEMENTO`, `BAIRRO`, `CIDADE`, `UF`. No Fornecedor saem todos vazios — o
  legado só tem o nome — e são todos opcionais: fornecedor sem endereço é
  aprovado normalmente, vazio não gera pendência. Preenchido, vale a regra do
  runtime: CEP com 8 dígitos (máscara aceita) e UF entre as 27 siglas. Nenhum
  endereço é pesquisado, deduzido ou preenchido automaticamente.
- **Custo de referência** (03/04): mediana das ofertas de fornecedor do legado
  (07) na unidade do item; sem oferta utilizável, mediana dos preços públicos
  (06). Todas as ofertas e preços do item ficam listados na própria linha.
  Referência manual — nunca custo real de compra.
- Nada é inventado nem fundido: o que falta fica vazio e vira pendência.
- Sem fórmula, sem macro; booleanos sempre `SIM`/`NÃO`; datas `dd/mm/aaaa`.

## Pesquisa de preço

Arquivo `|`-separado, fora do Git, com cabeçalho `# data_consulta: AAAA-MM-DD`:

```
FOUND|<cód. planilha>|<loja>|<url>|<embalagem>|<quantidade>|<unidade>|<preço>|<IGUAL|COMPARAVEL|APROXIMADA>|<grau>|<evidência>|<obs>
NOTFOUND|<cód. planilha>|<motivo>
```

O gerador normaliza para a unidade de estoque (Decimal, sem conversão entre
dimensões) e classifica a confiança (ALTA/MEDIA/BAIXA, critério na aba ORIGEM do
06). Referência de mercado nunca vira ItemCostReference, Receipt ou custo.

## Módulos

| Arquivo | Papel |
| --- | --- |
| `regras.py` | regras puras: chaves, CNPJ, endereço (CEP, UF), família, pureza, preço, confiança, semelhança de nomes |
| `fontes.py` | leitura das fontes e consolidação (registros, pendências, legado não importado) |
| `layout.py` | colunas, dicionário, valores permitidos e textos de cada arquivo |
| `planilha.py` | escrita padronizada dos .xlsx (estilo, tabela, listas suspensas) |
| `gerar_pacote.py` | gera os 8 arquivos e o manifesto |
| `validar_pacote.py` | valida o pacote gerado ou devolvido, e compara com a revisão anterior |
| `test_regras.py` | testes das regras |
| `test_devolucao.py` | cenários de devolução do 02 sobre cópia temporária do workbook |
