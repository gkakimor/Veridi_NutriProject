import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
// Marca oficial embutida no arquivo: o PDF não busca nada na rede.
import logoPng from "../assets/brand/veridi-logo.png?inline";
import { formatPdfDateTime, pdfSafe } from "./format";
import { PDF_COLOR, PDF_FONT, PDF_PAGE, PDF_SPACE } from "./theme";

/**
 * Fundação dos documentos PDF oficiais da Veridi.
 *
 * Todo documento baixável é montado com estas peças — nenhum módulo desenha
 * cabeçalho, rodapé, tabela ou bloco de totais por conta própria. O arquivo
 * sai do `@react-pdf/renderer` (ver `render.ts`): A4 de verdade, paginação
 * calculada pelo sistema e nada que dependa da impressora ou do navegador de
 * quem baixa — sem URL, data automática, título automático ou margem do
 * diálogo de impressão.
 *
 * As peças só DESENHAM. O dado chega pronto do domínio e formatado pelos
 * helpers de `format.ts`; conta não se faz aqui.
 */

type PdfStyle = Exclude<NonNullable<ComponentProps<typeof View>["style"]>, readonly unknown[]>;

export type PdfAlign = "left" | "center" | "right";

/** Proporção do arquivo oficial da marca (556 × 240 px). */
const LOGO = { width: 78.8, height: 34 };

const s = StyleSheet.create({
  page: {
    paddingTop: PDF_PAGE.marginTop,
    paddingBottom: PDF_PAGE.marginBottom,
    paddingHorizontal: PDF_PAGE.marginX,
    fontFamily: PDF_FONT.family,
    fontSize: PDF_FONT.size.base,
    // Sem `lineHeight` aqui: o renderer herda a entrelinha já convertida em
    // pontos, e o título de 15 pt ganhava a entrelinha do corpo de 8,5 pt —
    // o código do documento subia por cima dele. Cada texto declara a sua.
    color: PDF_COLOR.ink,
    backgroundColor: PDF_COLOR.paper,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: PDF_SPACE.md,
    // O respiro abaixo do cabeçalho vem da margem de cima do bloco seguinte
    // (título de seção, aviso) — ver `sectionTitle`.
    marginBottom: PDF_SPACE.hair,
    borderBottomWidth: 1.2,
    borderBottomColor: PDF_COLOR.brand,
  },
  logo: LOGO,
  identity: { alignItems: "flex-end", maxWidth: 340 },
  title: {
    fontSize: PDF_FONT.size.title,
    fontWeight: "bold",
    color: PDF_COLOR.brandDeep,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textAlign: "right",
  },
  code: { marginTop: 3, fontSize: PDF_FONT.size.lg, fontWeight: "bold", textAlign: "right" },
  headerLine: { marginTop: 2, fontSize: PDF_FONT.size.sm, color: PDF_COLOR.ink2, textAlign: "right" },
  draft: {
    marginTop: PDF_SPACE.xs,
    paddingVertical: 1.5,
    paddingHorizontal: PDF_SPACE.sm,
    borderWidth: 0.8,
    borderColor: PDF_COLOR.warn,
    color: PDF_COLOR.warn,
    fontSize: PDF_FONT.size.xs,
    fontWeight: "bold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  runningHeader: {
    position: "absolute",
    top: PDF_PAGE.runningHeaderTop,
    left: PDF_PAGE.marginX,
    right: PDF_PAGE.marginX,
  },
  runningHeaderBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: PDF_SPACE.xs,
    borderBottomWidth: 0.6,
    borderBottomColor: PDF_COLOR.lineStrong,
  },
  runningHeaderTitle: {
    fontSize: PDF_FONT.size.xs,
    fontWeight: "bold",
    color: PDF_COLOR.brand,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  runningHeaderCode: { fontSize: PDF_FONT.size.xs, color: PDF_COLOR.ink2 },

  footer: {
    position: "absolute",
    left: PDF_PAGE.marginX,
    right: PDF_PAGE.marginX,
    bottom: PDF_PAGE.footerBottom,
    paddingTop: PDF_SPACE.xs + 1,
    borderTopWidth: 0.6,
    borderTopColor: PDF_COLOR.lineStrong,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerNote: { fontSize: PDF_FONT.size.micro, color: PDF_COLOR.ink3, maxWidth: "76%" },
  footerStamp: { fontSize: PDF_FONT.size.micro, color: PDF_COLOR.ink3 },
  footerCode: { marginTop: 1.5, fontSize: PDF_FONT.size.xs, fontWeight: "bold", color: PDF_COLOR.ink2 },
  footerPage: { marginTop: 1.5, fontSize: PDF_FONT.size.xs, color: PDF_COLOR.ink2 },

  notice: {
    marginTop: PDF_SPACE.lg,
    marginBottom: PDF_SPACE.xs,
    paddingVertical: PDF_SPACE.xs + 1,
    paddingHorizontal: PDF_SPACE.md,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLOR.brand,
    backgroundColor: PDF_COLOR.band,
    fontSize: PDF_FONT.size.sm,
    lineHeight: PDF_FONT.lineHeight,
    color: PDF_COLOR.ink2,
  },

  /*
   * O espaço entre seções é margem de CIMA do título, nunca margem de baixo
   * do bloco: com margem inferior, o paginador levava o conteúdo inteiro
   * para a folha seguinte quando só a margem não cabia — e o título ficava
   * sozinho no pé da página. Margem de cima no topo da folha é descartada.
   */
  sectionTitle: {
    marginTop: PDF_SPACE.lg + 2,
    fontSize: PDF_FONT.size.sm,
    fontWeight: "bold",
    color: PDF_COLOR.brand,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    paddingBottom: PDF_SPACE.xs,
    marginBottom: PDF_SPACE.sm + 1,
    borderBottomWidth: 0.6,
    borderBottomColor: PDF_COLOR.line,
  },
  subheading: {
    marginTop: PDF_SPACE.md,
    marginBottom: PDF_SPACE.xs + 1,
    fontSize: PDF_FONT.size.xs,
    fontWeight: "bold",
    color: PDF_COLOR.ink2,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  field: { paddingRight: PDF_SPACE.lg, marginBottom: PDF_SPACE.sm + 1 },
  fieldLabel: {
    fontSize: PDF_FONT.size.micro,
    color: PDF_COLOR.ink3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: PDF_SPACE.hair,
  },
  fieldValue: { fontSize: PDF_FONT.size.md, lineHeight: PDF_FONT.lineHeight },

  table: { width: "100%" },
  thead: {
    flexDirection: "row",
    backgroundColor: PDF_COLOR.band,
    borderTopWidth: 0.6,
    borderTopColor: PDF_COLOR.lineStrong,
    borderBottomWidth: 0.9,
    borderBottomColor: PDF_COLOR.ink2,
  },
  th: {
    fontSize: PDF_FONT.size.micro,
    fontWeight: "bold",
    color: PDF_COLOR.ink2,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: PDF_COLOR.line },
  trEmphasis: { borderTopWidth: 0.9, borderTopColor: PDF_COLOR.ink2 },
  trContinued: { borderBottomWidth: 0 },
  cell: { paddingVertical: 4, paddingHorizontal: 4 },
  cellDense: { paddingVertical: 2.5, paddingHorizontal: 3 },
  td: { fontSize: PDF_FONT.size.base, lineHeight: PDF_FONT.lineHeight },
  tdDense: { fontSize: PDF_FONT.size.xs + 0.5 },
  empty: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontSize: PDF_FONT.size.base,
    color: PDF_COLOR.ink2,
  },

  totals: { alignSelf: "flex-end", width: 250, marginTop: PDF_SPACE.md },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  totalLabel: { fontSize: PDF_FONT.size.base, color: PDF_COLOR.ink2 },
  totalValue: { fontSize: PDF_FONT.size.base, textAlign: "right" },
  totalRowGrand: {
    marginTop: PDF_SPACE.xs,
    paddingTop: PDF_SPACE.sm,
    borderTopWidth: 1.2,
    borderTopColor: PDF_COLOR.brand,
  },
  totalLabelGrand: {
    fontSize: PDF_FONT.size.sm,
    fontWeight: "bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingTop: 1.5,
  },
  totalValueGrand: { fontSize: PDF_FONT.size.lg + 1, fontWeight: "bold", textAlign: "right" },

  bold: { fontWeight: "bold" },
  muted: { color: PDF_COLOR.ink2 },
  small: { fontSize: PDF_FONT.size.xs },
  note: {
    marginTop: PDF_SPACE.hair,
    fontSize: PDF_FONT.size.xs,
    lineHeight: PDF_FONT.lineHeight,
    color: PDF_COLOR.ink2,
  },
  paragraph: { marginBottom: PDF_SPACE.xs, fontSize: PDF_FONT.size.base, lineHeight: PDF_FONT.lineHeight },

  details: { flexDirection: "row", flexWrap: "wrap", marginTop: 1 },
  detail: { marginRight: PDF_SPACE.lg, fontSize: PDF_FONT.size.xs, color: PDF_COLOR.ink2 },
  detailValue: { fontWeight: "bold", color: PDF_COLOR.ink },

  signatures: { flexDirection: "row", marginTop: PDF_SPACE.xl + 8 },
  signature: { flexGrow: 1, flexBasis: 0, marginRight: PDF_SPACE.xl },
  signatureLine: { height: 22, borderBottomWidth: 0.8, borderBottomColor: PDF_COLOR.ink },
  signatureLabel: { marginTop: 2, fontSize: PDF_FONT.size.sm, color: PDF_COLOR.ink2 },

  checkboxCell: { alignItems: "center" },
  checkbox: { width: 8, height: 8, borderWidth: 0.8, borderColor: PDF_COLOR.ink },
  writeLine: { height: 11, borderBottomWidth: 0.6, borderBottomColor: PDF_COLOR.ink3 },
});

/** Junta estilos ignorando os condicionais desligados. */
function sx(...estilos: (PdfStyle | false | null | undefined)[]): PdfStyle[] {
  return estilos.filter((estilo): estilo is PdfStyle => Boolean(estilo));
}

/** Texto cru passa por `pdfSafe`; elemento segue como veio. */
function safe(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === "string" ? pdfSafe(child) : typeof child === "number" ? String(child) : child,
  );
}

/**
 * Ausência de dado: null, undefined, false ou texto em branco. "—" não entra:
 * é como o documento escreve "sem dado" (`orDash`), e valor escrito sai no
 * papel — campo opcional com "—" nunca some calado.
 */
function isBlank(value: ReactNode): boolean {
  if (value === null || value === undefined || value === false) return true;
  return typeof value === "string" && value.trim() === "";
}

// ---------------------------------------------------------------- documento

export type PdfDocumentProps = {
  /** Nome do documento — sai em caixa alta no cabeçalho: "Orçamento comercial". */
  title: string;
  /** Identificação: "ORC-000001 · V1". Vai ao cabeçalho, ao corrido e ao rodapé. */
  code: string;
  /** Situação atual, já rotulada pelo domínio: "Enviado". */
  status?: string | null;
  /** Rascunho é marcado — nunca parece documento final. */
  isDraft?: boolean;
  /**
   * Código do documento controlado (R.PRO.002). Sai no cabeçalho e no rodapé
   * de toda folha — suporte documental, não declaração de certificação.
   */
  documentCode?: string | null;
  /** Linhas curtas sob o código: revisão, emissão, quem gerou… */
  headerLines?: (string | null | false | undefined)[];
  /** Natureza do documento, no rodapé de toda página. */
  footerNote?: string;
  /** Carimbo da geração. Vem sempre do chamador — nunca do navegador. */
  generatedAt: Date;
  /** Paisagem só onde a largura realmente exige. */
  landscape?: boolean;
  children: ReactNode;
};

/**
 * A folha: A4, margens da casa, cabeçalho na página 1, cabeçalho corrido nas
 * seguintes e rodapé com "Página X de Y" em todas.
 */
export function PdfDocument({
  title,
  code,
  status,
  isDraft,
  documentCode,
  headerLines = [],
  footerNote,
  generatedAt,
  landscape,
  children,
}: PdfDocumentProps) {
  const linhas = headerLines.filter((linha): linha is string => Boolean(linha));
  return (
    <Document
      title={pdfSafe(`${title} ${code}`)}
      author="Veridi Nutrition"
      creator="Veridi Nutrition"
      producer="Veridi Nutrition"
      language="pt-BR"
    >
      <Page size={PDF_PAGE.size} orientation={landscape ? "landscape" : "portrait"} style={s.page}>
        <RunningHeader title={title} code={code} />

        <View style={s.header}>
          <Image src={logoPng} style={s.logo} />
          <View style={s.identity}>
            <Text style={s.title}>{pdfSafe(title)}</Text>
            <Text style={s.code}>{pdfSafe(code)}</Text>
            {documentCode ? <Text style={s.headerLine}>{pdfSafe(documentCode)}</Text> : null}
            {linhas.map((linha, indice) => (
              <Text key={`${indice}-${linha}`} style={s.headerLine}>
                {pdfSafe(linha)}
              </Text>
            ))}
            {status ? <Text style={s.headerLine}>Status: {pdfSafe(status)}</Text> : null}
            {isDraft ? (
              <Text style={s.draft} data-pdf-role="draft">
                Rascunho
              </Text>
            ) : null}
          </View>
        </View>

        {children}

        <Footer
          code={[code, documentCode].filter(Boolean).join(" · ")}
          note={footerNote}
          generatedAt={generatedAt}
        />
      </Page>
    </Document>
  );
}

/** Da página 2 em diante: de que documento é a folha que se soltou da pilha. */
function RunningHeader({ title, code }: { title: string; code: string }) {
  return (
    <View
      fixed
      style={s.runningHeader}
      render={({ pageNumber }) =>
        pageNumber > 1 ? (
          <View style={s.runningHeaderBar}>
            <Text style={s.runningHeaderTitle}>{pdfSafe(title)}</Text>
            <Text style={s.runningHeaderCode}>{pdfSafe(code)}</Text>
          </View>
        ) : null
      }
    />
  );
}

function Footer({
  code,
  note,
  generatedAt,
}: {
  code: string;
  note?: string | undefined;
  generatedAt: Date;
}) {
  return (
    <View fixed style={s.footer}>
      <View style={s.footerRow}>
        <Text style={s.footerNote}>{pdfSafe(["Veridi Nutrition", note].filter(Boolean).join(" · "))}</Text>
        <Text style={s.footerStamp}>Gerado em {formatPdfDateTime(generatedAt)}</Text>
      </View>
      <View style={s.footerRow}>
        <Text style={s.footerCode}>{pdfSafe(code)}</Text>
        <Text
          style={s.footerPage}
          render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- blocos

/**
 * Seção com título pequeno — nunca compete com o título do documento.
 *
 * O título não fica sozinho no pé da página: leva ao menos o começo do
 * conteúdo junto. Para isso ele é IRMÃO do conteúdo, não primeiro filho do
 * mesmo bloco — o renderer só empurra um elemento para a folha seguinte
 * quando há irmão antes dele, e o título primeiro-filho ficava órfão. O
 * bloco do conteúdo não tem margem inferior (ver `sectionTitle`), e o título
 * não se parte: com a régua e o respiro abaixo do texto, ele podia sobrar por
 * poucos pontos e o renderer o dividia — texto no pé da folha, régua na
 * seguinte.
 */
export function PdfSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Text style={s.sectionTitle} minPresenceAhead={48} wrap={false}>
        {pdfSafe(title)}
      </Text>
      <View>{children}</View>
    </>
  );
}

/** Subtítulo dentro de uma seção (ex.: plano de pagamento). */
export function PdfSubheading({ title }: { title: string }) {
  return (
    <Text style={s.subheading} minPresenceAhead={44} wrap={false}>
      {pdfSafe(title)}
    </Text>
  );
}

/**
 * Bloco que não se divide entre páginas (subtítulo + tabela curta, par de
 * campos que só se lê junto). Bloco maior que uma folha não pode ser mantido
 * inteiro — nesse caso passe `keepTogether={false}`.
 */
export function PdfBlock({ children, keepTogether = true }: { children: ReactNode; keepTogether?: boolean }) {
  return <View wrap={!keepTogether}>{children}</View>;
}

/** Aviso obrigatório do documento (ex.: faturamento não é Nota Fiscal). */
export function PdfNotice({ children }: { children: ReactNode }) {
  return (
    <Text style={s.notice} data-pdf-role="notice">
      {safe(children)}
    </Text>
  );
}

export type PdfField = {
  label: string;
  value: ReactNode;
  /** Largura em colunas de 12. Padrão 4 (um terço da linha). */
  span?: number;
  /**
   * Opcional vazio sai do documento em vez de virar buraco. Vazio é dado
   * ausente (`null`, texto em branco), não "—": valor já formatado sai no
   * papel — quem quer que o campo suma passa o dado cru.
   */
  optional?: boolean;
};

/**
 * Frações de 12 truncadas (nunca arredondadas para cima): qualquer combinação
 * que some 12 fecha em ≤ 100%. Com arredondamento, 2 + 2 + 8 dava 100,0001% e
 * o último campo descia sozinho para a linha de baixo.
 */
const SPAN_WIDTH: Record<number, string> = {
  1: "8.3333%",
  2: "16.6666%",
  3: "25%",
  4: "33.3333%",
  5: "41.6666%",
  6: "50%",
  7: "58.3333%",
  8: "66.6666%",
  9: "75%",
  10: "83.3333%",
  11: "91.6666%",
  12: "100%",
};

/**
 * Campos rotulados em grade de 12 colunas. Cada campo ocupa a largura do seu
 * significado (razão social larga, CEP estreito); a linha quebra sozinha.
 * Campo vazio sai "—", nunca buraco; opcional vazio sai do papel.
 */
export function PdfDataGrid({ fields }: { fields: (PdfField | false | null | undefined)[] }) {
  const visiveis = fields.filter(
    (field): field is PdfField => Boolean(field) && !(field && field.optional && isBlank(field.value)),
  );
  return (
    <View style={s.grid}>
      {visiveis.map((field, indice) => (
        <View
          key={`${indice}-${field.label}`}
          style={sx(s.field, { width: SPAN_WIDTH[field.span ?? 4] ?? "33.3333%" })}
          wrap={false}
          data-pdf-role="field"
        >
          <Text style={s.fieldLabel}>{pdfSafe(field.label)}</Text>
          {isBlank(field.value) ? (
            <Text style={s.fieldValue}>—</Text>
          ) : typeof field.value === "string" || typeof field.value === "number" ? (
            <Text style={s.fieldValue}>{pdfSafe(String(field.value))}</Text>
          ) : (
            field.value
          )}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- tabela

export type PdfColumn = {
  header: string;
  /**
   * Largura fixa em pt — número, quantidade, unidade, código. A coluna fica
   * no mesmo lugar em toda linha, qualquer que seja o texto das outras.
   */
  width?: number;
  /** Peso na sobra da largura: a coluna de texto principal. */
  flex?: number;
  align?: PdfAlign;
};

const TableColumns = createContext<readonly PdfColumn[]>([]);
const CellColumns = createContext<readonly PdfColumn[]>([]);
const CellAlign = createContext<PdfAlign>("left");
const TableDense = createContext(false);

/** Caixa da célula: soma das larguras fixas + fatia da sobra das flexíveis. */
function cellBox(columns: readonly PdfColumn[]): PdfStyle {
  let basis = 0;
  let grow = 0;
  for (const column of columns) {
    basis += column.width ?? 0;
    grow += column.width === undefined ? (column.flex ?? 1) : 0;
  }
  return { flexBasis: basis, flexGrow: grow, flexShrink: 0 };
}

/**
 * Tabela documental. O cabeçalho se repete no topo de toda página em que a
 * tabela continua; uma linha nunca se divide entre duas páginas.
 */
export function PdfTable({
  columns,
  children,
  isEmpty,
  emptyMessage = "Nenhum registro.",
  dense = false,
}: {
  columns: readonly PdfColumn[];
  children?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Relatório largo: corpo menor e célula mais justa — coluna cortada é dado perdido. */
  dense?: boolean;
}) {
  return (
    <TableColumns.Provider value={columns}>
      <TableDense.Provider value={dense}>
        <View style={s.table}>
          <View fixed style={s.thead} data-pdf-role="header-row">
            {columns.map((column, index) => (
              <View
                key={`${column.header}-${index}`}
                style={sx(s.cell, dense && s.cellDense, cellBox([column]))}
              >
                <Text style={sx(s.th, { textAlign: column.align ?? "left" })}>{pdfSafe(column.header)}</Text>
              </View>
            ))}
          </View>
          {children}
          {isEmpty ? (
            <View style={s.tr} wrap={false} data-pdf-role="row">
              <Text style={s.empty}>{pdfSafe(emptyMessage)}</Text>
            </View>
          ) : null}
        </View>
      </TableDense.Provider>
    </TableColumns.Provider>
  );
}

/**
 * Linha da tabela. Os filhos são `PdfTd`, na ordem das colunas — `span`
 * ocupa várias. Célula não vai dentro de Fragment: a contagem de colunas é
 * feita sobre os filhos diretos.
 */
export function PdfTr({
  children,
  emphasis,
  continued,
}: {
  children: ReactNode;
  /** Linha de total dentro da tabela: régua acima. */
  emphasis?: boolean;
  /** Linha principal seguida da linha de detalhe: sem régua entre as duas. */
  continued?: boolean;
}) {
  const columns = useContext(TableColumns);
  let proxima = 0;
  const celulas = Children.toArray(children).map((child, index) => {
    if (!isValidElement<PdfTdProps>(child)) return child;
    const span = child.props.span ?? 1;
    const cobertas = columns.slice(proxima, proxima + span);
    proxima += span;
    return (
      <CellColumns.Provider key={child.key ?? index} value={cobertas}>
        {child}
      </CellColumns.Provider>
    );
  });
  return (
    <View wrap={false} style={sx(s.tr, continued && s.trContinued, emphasis && s.trEmphasis)} data-pdf-role="row">
      {celulas}
    </View>
  );
}

export type PdfTdProps = {
  children?: ReactNode;
  /** Quantas colunas a célula ocupa. */
  span?: number;
  /** Por padrão, o alinhamento da coluna. */
  align?: PdfAlign;
  bold?: boolean;
  muted?: boolean;
};

export function PdfTd({ children, align, bold, muted }: PdfTdProps) {
  const cobertas = useContext(CellColumns);
  const denso = useContext(TableDense);
  const alinhamento = align ?? cobertas[0]?.align ?? "left";
  const estilo = sx(s.td, denso && s.tdDense, { textAlign: alinhamento }, bold && s.bold, muted && s.muted);
  const itens = Children.toArray(children);
  const soTexto = itens.every((item) => typeof item === "string" || typeof item === "number");

  return (
    <View style={sx(s.cell, denso && s.cellDense, cellBox(cobertas))} data-pdf-role="cell">
      <CellAlign.Provider value={alinhamento}>
        {soTexto ? (
          <Text style={estilo}>{pdfSafe(itens.map((item) => String(item)).join(""))}</Text>
        ) : (
          itens.map((item, index) =>
            typeof item === "string" || typeof item === "number" ? (
              <Text key={index} style={estilo}>
                {pdfSafe(String(item))}
              </Text>
            ) : (
              item
            ),
          )
        )}
      </CellAlign.Provider>
    </View>
  );
}

// ---------------------------------------------------------------- totais

export type PdfTotalLine = {
  label: string;
  value: string;
  /** O total que vale: maior peso, régua verde acima. */
  grand?: boolean;
};

/**
 * Bloco de totais à direita, fora da tabela — total não se lê como mais uma
 * linha de produto. Os valores vêm prontos do domínio; nada é somado aqui.
 */
export function PdfTotals({ lines }: { lines: (PdfTotalLine | false | null | undefined)[] }) {
  const visiveis = lines.filter((line): line is PdfTotalLine => Boolean(line));
  return (
    <View style={s.totals} wrap={false} data-pdf-role="totals">
      {visiveis.map((line) => (
        <View key={line.label} style={sx(s.totalRow, line.grand && s.totalRowGrand)}>
          <Text style={line.grand ? s.totalLabelGrand : s.totalLabel}>{pdfSafe(line.label)}</Text>
          <Text style={line.grand ? s.totalValueGrand : s.totalValue}>{pdfSafe(line.value)}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- texto

/** Texto corrido. Dentro de célula, herda o alinhamento da coluna. */
export function PdfText({
  children,
  bold,
  muted,
  small,
  align,
}: {
  children: ReactNode;
  bold?: boolean;
  muted?: boolean;
  small?: boolean;
  align?: PdfAlign;
}) {
  const herdado = useContext(CellAlign);
  return (
    <Text style={sx({ textAlign: align ?? herdado }, small && s.small, muted && s.muted, bold && s.bold)}>
      {safe(children)}
    </Text>
  );
}

/** Ressalva curta sob um valor: no papel não há ⓘ para abrir. */
export function PdfNote({ children }: { children: ReactNode }) {
  const herdado = useContext(CellAlign);
  return (
    <Text style={sx(s.note, { textAlign: herdado })} data-pdf-role="note">
      {safe(children)}
    </Text>
  );
}

/** Parágrafo "Rótulo: valor". */
export function PdfKeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text style={s.paragraph} data-pdf-role="kv">
      <Text style={s.bold}>{pdfSafe(label)}</Text> {safe(children)}
    </Text>
  );
}

/** Parágrafo simples. */
export function PdfParagraph({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={sx(s.paragraph, muted && s.muted)}>{safe(children)}</Text>;
}

/** Lista "rótulo: valor" em linha — detalhe de uma linha de tabela. */
export function PdfDetails({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <View style={s.details} data-pdf-role="details">
      {items.map((item) => (
        <Text key={item.label} style={s.detail}>
          {pdfSafe(item.label)}: <Text style={s.detailValue}>{safe(item.value)}</Text>
        </Text>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- papel de chão

/**
 * Espaço de assinatura em papel — deliberadamente NÃO é assinatura
 * eletrônica nem aprovação digital; o registro válido é o do sistema.
 */
export function PdfSignatures({ fields = ["Responsável / assinatura", "Data"] }: { fields?: string[] }) {
  return (
    <View style={s.signatures} wrap={false} data-pdf-role="signatures">
      {fields.map((field) => (
        <View key={field} style={s.signature}>
          <View style={s.signatureLine} />
          <Text style={s.signatureLabel}>{pdfSafe(field)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Caixa de conferência em papel — nunca persiste nada. */
export function PdfCheckBox() {
  return (
    <View style={s.checkboxCell} data-pdf-role="checkbox">
      <View style={s.checkbox} />
    </View>
  );
}

/** Linha em branco para anotação à mão (contagem, lote, observação). */
export function PdfWriteLine() {
  return <View style={s.writeLine} data-pdf-role="write" />;
}
