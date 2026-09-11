import { COST_PER_1000_LABEL, hojeComercial } from "@veridi/shared";
import { COLUNA_NUMERICA } from "../../print/PrintLayout";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDetails,
  PdfDocument,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { orDash, pdfFileName } from "../format";

/**
 * Relatórios R-01…R-20 em PDF — um documento só, dirigido pelas colunas.
 *
 * O dado é o MESMO CSV de exportação que a tela oferece: resultado filtrado
 * completo (`ALL_ROWS`), colunas rotuladas e valores já escritos pela API. O
 * papel não reimplementa relatório, não refaz conta e não reformata número:
 * escreve o que veio. Célula vazia é valor desconhecido e sai "—", nunca zero.
 *
 * R-06 e R-14 são consultas de documento único e têm módulo próprio.
 */

/** Ressalva dos relatórios com custo e margem — o texto do impresso anterior. */
export const REPORT_INTERNAL_NOTICE =
  "Documento interno. Contém custo e margem — não é o orçamento entregue ao cliente.";

export const REPORT_EMPTY_MESSAGE = "Nenhum registro para os filtros aplicados.";

/** No rodapé de toda folha: a folha solta de relatório interno se identifica sozinha. */
const NOTA_INTERNA = "Documento interno — contém custo e margem.";

export type ReportPdfInput = {
  /** Código do relatório: "R-01". */
  code: string;
  /** Nome do relatório: "Posição de Estoque". */
  title: string;
  /** Contém custo/margem: documento interno, nunca entregue ao cliente. */
  internal?: boolean | undefined;
  /**
   * Relatório largo demais para uma linha só: estas colunas formam a linha
   * principal e TODAS as outras descem, rotuladas, para a linha de detalhe
   * logo abaixo. Nada some do papel — só deixa de disputar largura.
   */
  primaryColumns?: readonly string[] | undefined;
  /** Cabeçalho do CSV da API, na ordem. */
  header: string[];
  rows: string[][];
  /** Filtros da origem, já rotulados pela página. */
  filters: { label: string; value: string }[];
  /** Quem gerou o documento — não substitui quem executou cada ato no sistema. */
  generatedBy: string | null;
};

type Formato = Omit<PdfColumn, "header">;

/*
 * Largura das colunas conhecidas, em pt, para a tabela densa (corpo 7,5 pt).
 *
 * O renderer só quebra linha em espaço: código de lote, número e rótulo de
 * uma palavra não se partem. A largura fixa cabe o mais longo deles — e a
 * palavra mais longa do cabeçalho, em caixa alta — com a coluna no mesmo
 * lugar em toda linha e em toda página. Texto livre (descrição, nome,
 * cliente) fica com a sobra, via `flex`.
 */
const LOTE: Formato = { width: 80 }; // LT-20260903-000803
const DATA: Formato = { width: 48 };
const DATA_HORA: Formato = { width: 76 };
const UNIDADE: Formato = { width: 40, align: "center" };
const QUANTIDADE: Formato = { width: 58, align: "right" };
const DINHEIRO: Formato = { width: 62, align: "right" };

const FORMATO_DA_COLUNA: Record<string, Formato> = {
  // Identificação: código inteiro, sem quebra.
  Item: { width: 56 },
  Produto: { width: 60 },
  OP: { width: 50 },
  OC: { width: 50 },
  Pedido: { width: 54 },
  "Pedido relacionado": { width: 60 },
  "Pedido do cliente": { width: 56 },
  Recebimento: { width: 60 },
  Expedição: { width: 54 },
  Faturamento: { width: 64 },
  "Faturamento em preparação": { width: 60 },
  Documento: { width: 60 },
  "Lote interno": LOTE,
  Lote: LOTE,
  "Lote do fornecedor": { width: 70 },
  "Lote Veridi": { width: 56 },
  Projeto: { width: 56 },
  Orçamento: { width: 72 }, // ORC-000001 · V12
  Precificação: { width: 70 },
  "Último cálculo": { width: 58 },
  "Cálculo de custo": { width: 58 },
  Cálculo: { width: 58 },
  Formulação: { width: 58 },

  // Rótulos de situação, tipo e origem.
  Tipo: { width: 60 },
  Status: { width: 62 },
  "Status da OP": { width: 58 },
  Qualidade: { width: 70 },
  "Qualidade do custo": { width: 70 },
  CoA: { width: 62 },
  Origem: { width: 56 },
  Situação: { width: 56 },
  Fornecimento: { width: 64 },
  "Modo de preço": { width: 64 },
  "Origem do custo": { width: 64 },
  "Origem do preço": { width: 70 },

  // Datas e carimbos.
  Data: DATA,
  Validade: DATA,
  Previsão: DATA,
  Início: DATA,
  "Data do custo": DATA,
  Conclusão: { width: 54 },
  "Entrega solicitada": { width: 52 },
  "Data de emissão": { width: 50 },
  "Confirmada em": { width: 56 },
  "Data de referência": { width: 54 },
  "Data/Hora": DATA_HORA,
  "Calculado em": DATA_HORA,
  "Ativada em": DATA_HORA,
  "Enviado em": DATA_HORA,
  "Aceito em": DATA_HORA,

  Unidade: UNIDADE,
  "Unidade da base": UNIDADE,

  // Quantidades.
  "On Hand": QUANTIDADE,
  Reservado: QUANTIDADE,
  Disponível: QUANTIDADE,
  Quantidade: QUANTIDADE,
  "Quantidade consumida": QUANTIDADE,
  "Quantidade calculada": QUANTIDADE,
  Necessário: QUANTIDADE,
  "Em compra": QUANTIDADE,
  Falta: QUANTIDADE,
  Planejado: QUANTIDADE,
  Produzido: QUANTIDADE,
  Variação: QUANTIDADE,
  Recebido: QUANTIDADE,
  "Em aberto": QUANTIDADE,
  "Qtd. pedida": QUANTIDADE,
  Expedido: QUANTIDADE,
  Faturado: QUANTIDADE,
  "Falta expedir": QUANTIDADE,
  "Expedido sem faturar": QUANTIDADE,
  "Falta entregar": QUANTIDADE,
  Faixa: QUANTIDADE,

  // Contagens.
  "Dias até vencer": { width: 40, align: "right" },
  "Dias de atraso": { width: 40, align: "right" },
  "Dias aguardando": { width: 58, align: "right" },
  Linhas: { width: 40, align: "right" },
  Itens: { width: 36, align: "right" },
  OPs: { width: 32, align: "right" },
  Recebimentos: { width: 64, align: "right" },
  Expedições: { width: 54, align: "right" },
  Faturamentos: { width: 66, align: "right" },
  "Linhas com preço": { width: 44, align: "right" },

  // Dinheiro.
  "Custo material unitário": DINHEIRO,
  "Custo unitário": { width: 60, align: "right" },
  "Custo do consumo": DINHEIRO,
  "Valor previsto": DINHEIRO,
  "Preço previsto (OC)": DINHEIRO,
  "Custo efetivo": { width: 60, align: "right" },
  Valor: DINHEIRO,
  "Custo industrial total": { width: 66, align: "right" },
  "Subtotal conhecido": DINHEIRO,
  "Custo/unidade": { width: 66, align: "right" },
  [COST_PER_1000_LABEL]: DINHEIRO,
  Preço: { width: 58, align: "right" },
  // "CONTRIBUIÇÃO/UNIDADE" é uma palavra só no cabeçalho: não quebra.
  "Contribuição/unidade": { width: 96, align: "right" },
  "Preço unitário": DINHEIRO,
  Total: { width: 64, align: "right" },
  "Custo industrial/un": DINHEIRO,

  // Percentuais.
  "Rendimento (%)": { width: 54, align: "right" },
  "Comissão (%)": { width: 48, align: "right" },
  "Margem de contribuição (%)": DINHEIRO,
  "Markup (%)": { width: 46, align: "right" },

  // Texto livre: a sobra da largura.
  Descrição: { flex: 2 },
  "Nome do produto": { flex: 2 },
  Nome: { flex: 2 },
  Cliente: { flex: 1.5 },
  Fornecedor: { flex: 1.5 },
  "Nome do projeto": { flex: 1.5 },
  Motivo: { flex: 1.5 },
  Produtos: { flex: 1.5 },
  Usuário: { flex: 1 },
  Proprietário: { flex: 1 },
  Localização: { flex: 1 },
  "Referência externa": { flex: 1 },
  "Estrutura ativa": { flex: 1 },
};

/** Mesmo rótulo, outro dado: em R-10/R-11 "Pedido" é a quantidade pedida na OC. */
const FORMATO_POR_RELATORIO: Record<string, Record<string, Formato>> = {
  "R-10": { Pedido: QUANTIDADE },
  "R-11": { Pedido: QUANTIDADE },
};

/**
 * Coluna do PDF para um cabeçalho do CSV. Coluna que o documento ainda não
 * conhece não some: vai à direita se o rótulo é numérico (a mesma regra do
 * impresso anterior) e, se não, divide a sobra com o texto livre.
 */
export function reportPdfColumn(code: string, header: string): PdfColumn {
  const formato: Formato = FORMATO_POR_RELATORIO[code]?.[header] ??
    FORMATO_DA_COLUNA[header] ??
    (COLUNA_NUMERICA.test(header.trim()) ? { width: 60, align: "right" } : { flex: 1 });
  return { header, ...formato };
}

export type ReportPdfLayout = {
  landscape: boolean;
  /** Colunas da tabela — as da linha principal. */
  columns: PdfColumn[];
  /** Posições (no CSV) das colunas da linha principal, na ordem. */
  main: number[];
  /** Posições das colunas que descem para a linha de detalhe. */
  detail: number[];
};

export function reportPdfLayout(
  report: Pick<ReportPdfInput, "code" | "header" | "primaryColumns">,
): ReportPdfLayout {
  const { code, header } = report;
  const todas = header.map((_, posicao) => posicao);
  const principais = (report.primaryColumns ?? [])
    .map((coluna) => header.indexOf(coluna))
    .filter((posicao) => posicao >= 0);
  const detail = principais.length > 0 ? todas.filter((posicao) => !principais.includes(posicao)) : [];
  const main = detail.length > 0 ? principais : todas;
  return {
    // Mesma regra do impresso anterior: mais de 7 colunas vai para paisagem.
    landscape: header.length > 7,
    columns: main.map((posicao) => reportPdfColumn(code, header[posicao] ?? "")),
    main,
    detail,
  };
}

/** "R-01-2026-09-11.pdf": código do relatório + dia da geração, no fuso da operação. */
export function reportPdfFileName(code: string, generatedAt: Date): string {
  return pdfFileName(code, hojeComercial(generatedAt));
}

/** Célula do CSV; vazia é desconhecida e sai "—" — o papel nunca inventa zero. */
function valor(cells: string[], posicao: number): string {
  return orDash(cells[posicao]?.trim());
}

export function ReportPdf({ report, generatedAt }: { report: ReportPdfInput; generatedAt: Date }) {
  const { code, title, internal, header, rows, filters, generatedBy } = report;
  const { landscape, columns, main, detail } = reportPdfLayout(report);

  return (
    <PdfDocument
      title={title}
      code={code}
      headerLines={[`Gerado por ${orDash(generatedBy)}`]}
      {...(internal ? { footerNote: NOTA_INTERNA } : {})}
      generatedAt={generatedAt}
      landscape={landscape}
    >
      {internal ? <PdfNotice>{REPORT_INTERNAL_NOTICE}</PdfNotice> : null}

      {/* O papel diz o que está mostrando: recorte e quantos registros. */}
      <PdfSection title="Filtros aplicados">
        <PdfDataGrid
          fields={[
            ...filters.map((filtro) => ({ label: filtro.label, value: orDash(filtro.value), span: 3 })),
            { label: "Registros", value: String(rows.length), span: 3 },
          ]}
        />
      </PdfSection>

      <PdfTable columns={columns} dense isEmpty={rows.length === 0} emptyMessage={REPORT_EMPTY_MESSAGE}>
        {rows.map((cells, indice) => {
          const chave = `${indice}-${cells[0] ?? ""}`;
          const principal = main.map((posicao) => <PdfTd key={posicao}>{valor(cells, posicao)}</PdfTd>);
          if (detail.length === 0) return <PdfTr key={chave}>{principal}</PdfTr>;
          // Linha principal e detalhe são um registro só: não se separam.
          return (
            <PdfBlock key={chave}>
              <PdfTr continued>{principal}</PdfTr>
              <PdfTr>
                <PdfTd span={main.length}>
                  <PdfDetails
                    items={detail.map((posicao) => ({
                      label: header[posicao] ?? "",
                      value: valor(cells, posicao),
                    }))}
                  />
                </PdfTd>
              </PdfTr>
            </PdfBlock>
          );
        })}
      </PdfTable>
    </PdfDocument>
  );
}
