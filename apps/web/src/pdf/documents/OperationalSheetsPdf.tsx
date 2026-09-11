import {
  COA_STATUS_LABELS,
  LOT_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  hojeComercial,
  ownerLabel,
} from "@veridi/shared";
import type {
  InventoryOwnerType,
  InventoryPositionRowDTO,
  LotStatus,
  MaterialReservationLineDTO,
  ProductionOrderDTO,
  QualityQueueRowDTO,
  ShipmentDTO,
} from "@veridi/shared";
import {
  PdfCheckBox,
  PdfDataGrid,
  PdfDocument,
  PdfNotice,
  PdfSection,
  PdfSignatures,
  PdfTable,
  PdfTd,
  PdfTr,
  PdfWriteLine,
  type PdfColumn,
  type PdfField,
} from "../components";
import { formatDate, formatQuantity, orDash, pdfFileName } from "../format";

/**
 * Folhas operacionais (FO-01…FO-05) em PDF.
 *
 * Papel de chão de fábrica: o operador baixa ou imprime, anota à mão e volta
 * a registrar no ERP. As mesmas regras valem para todas:
 * 1. a folha traz o RESULTADO FILTRADO COMPLETO que a página carregou —
 *    nunca só a página aberta na tela — e diz no papel o filtro aplicado;
 * 2. campos de anotação são de papel: contagem, conferência e assinatura não
 *    viram dado e o papel nunca aprova nada — quem registra é o ERP, depois;
 * 3. valor desconhecido sai "—", nunca zero.
 *
 * `FO-xx` é identificação documental, não entidade: não existe tabela de
 * folha operacional em lugar nenhum. O código vai ao cabeçalho, ao cabeçalho
 * corrido e ao rodapé de toda página.
 *
 * As tabelas são densas: são largas, e coluna cortada é dado perdido.
 */

/** Carimbo e autoria do papel — o mesmo carimbo dá nome ao arquivo. */
type Emissao = {
  generatedAt: Date;
  /**
   * Quem gerou o PAPEL — não substitui os snapshots de quem executou ou
   * aprovou cada ato no sistema. Sem sessão, "—": nunca um nome inventado.
   */
  generatedBy: string | null;
};

function geradoPor(nome: string | null): string {
  return `Gerado por ${orDash(nome)}`;
}

/** O papel precisa dizer o que ele mostra: o filtro viaja com a folha. */
function FiltrosAplicados({ fields }: { fields: (PdfField | null)[] }) {
  return (
    <PdfSection title="Filtros aplicados">
      <PdfDataGrid fields={fields} />
    </PdfSection>
  );
}

/**
 * Situação do lote no papel.
 *
 * Vencimento manda sobre o estado gravado: um lote ainda marcado como
 * disponível, mas fora da validade, não pode aparecer no papel como
 * disponível.
 */
function situacaoDoLote(status: LotStatus | null, isExpired: boolean): string {
  if (isExpired) return LOT_STATUS_LABELS.EXPIRED;
  return status ? LOT_STATUS_LABELS[status] : "—";
}

/** Material de cliente diz de quem é; o da Veridi, de quem veio. */
function fornecedorOuProprietario(row: {
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  supplierName: string | null;
}): string {
  return row.ownerType === "CUSTOMER"
    ? ownerLabel(row.ownerType, row.ownerCustomerName)
    : orDash(row.supplierName);
}

/** "2026-09-11": o dia comercial da geração, no nome do arquivo. */
function diaDaEmissao(generatedAt: Date): string {
  return hojeComercial(generatedAt);
}

/* ─────────────── FO-01 — Contagem física ─────────────── */

const FO01_TITULO = "Folha de contagem física de estoque";

/**
 * Com a coluna "Proprietário" a folha não cabe em retrato, e espremer as
 * colunas de escrita à mão (contagem, diferença, observação) inviabiliza o
 * uso no chão de fábrica.
 *
 * Contar material de cliente junto com o da Veridi, sem dizer de quem é, é a
 * forma mais fácil de tratar estoque alheio como próprio. FO-02 e FO-03 já
 * mostram o proprietário.
 */
function colunasDaContagem(blind: boolean): PdfColumn[] {
  return [
    { header: "Código", width: 54 },
    { header: "Item", flex: 1 },
    { header: "Lote", width: 82 },
    { header: "Proprietário", width: 70 },
    { header: "Validade", width: 48 },
    { header: "Localização", width: 60 },
    { header: "Un.", width: 28, align: "center" },
    // Contagem cega: quem conta não vê o número esperado.
    ...(blind ? [] : [{ header: "Saldo sistema", width: 58, align: "right" as const }]),
    // Escrita à mão: o rótulo centrado sobre a linha não cola no saldo ao lado.
    { header: "Contagem física", width: 64, align: "center" },
    { header: "Diferença", width: 56, align: "center" },
    { header: "Observação", width: 100 },
  ];
}

export function inventoryCountPdfFileName({
  blind,
  generatedAt,
}: {
  blind: boolean;
  generatedAt: Date;
}): string {
  // A folha cega não pode ser confundida com a que traz o saldo.
  return pdfFileName("FO-01", "contagem-fisica", blind ? "cega" : null, diaDaEmissao(generatedAt));
}

/**
 * O operador baixa ou imprime, conta no estoque e depois registra o
 * Inventário Físico no sistema. O papel nunca ajusta saldo.
 *
 * Contagem cega (`?cega=1` na rota) esconde o saldo do sistema: quem conta não
 * vê o número esperado, que é justamente o ponto de uma contagem confiável.
 */
export function InventoryCountPdf({
  rows,
  blind,
  search,
  itemType,
  generatedAt,
  generatedBy,
}: Emissao & {
  rows: InventoryPositionRowDTO[];
  blind: boolean;
  search: string;
  itemType: string;
}) {
  return (
    <PdfDocument
      title={FO01_TITULO}
      code="FO-01"
      headerLines={[blind ? "Contagem cega — saldo do sistema omitido" : null, geradoPor(generatedBy)]}
      footerNote="Folha operacional de papel — a contagem anotada não ajusta saldo; o inventário é registrado no sistema."
      generatedAt={generatedAt}
      landscape
    >
      <FiltrosAplicados
        fields={[
          search ? { label: "Busca", value: search, span: 3 } : null,
          itemType ? { label: "Tipo de item", value: itemType, span: 3 } : null,
          { label: "Linhas", value: String(rows.length), span: 3 },
          { label: "Modo", value: blind ? "Contagem cega" : "Com saldo do sistema", span: 3 },
        ]}
      />

      <PdfSection title="Itens a contar">
        <PdfTable
          columns={colunasDaContagem(blind)}
          dense
          isEmpty={rows.length === 0}
          emptyMessage="Nenhum item no filtro aplicado."
        >
          {rows.map((row) => (
            <PdfTr key={`${row.itemId}-${row.lotId ?? "sem-lote"}`}>
              <PdfTd>{row.itemCode}</PdfTd>
              <PdfTd>{row.itemName}</PdfTd>
              <PdfTd>{orDash(row.lotCode)}</PdfTd>
              <PdfTd>{ownerLabel(row.ownerType, row.ownerCustomerName)}</PdfTd>
              <PdfTd>{formatDate(row.expiryDate)}</PdfTd>
              <PdfTd>{orDash(row.location)}</PdfTd>
              <PdfTd>{row.unitCode}</PdfTd>
              {blind ? null : <PdfTd>{formatQuantity(row.onHand)}</PdfTd>}
              <PdfTd>
                <PdfWriteLine />
              </PdfTd>
              <PdfTd>
                <PdfWriteLine />
              </PdfTd>
              <PdfTd>
                <PdfWriteLine />
              </PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSignatures fields={["Contagem realizada por", "Conferido por", "Data"]} />
    </PdfDocument>
  );
}

/* ─────────────── FO-02 — Posição de estoque ─────────────── */

const COLUNAS_POSICAO: PdfColumn[] = [
  { header: "Código", width: 54 },
  { header: "Item", flex: 1 },
  { header: "Lote", width: 82 },
  { header: "Fornecedor / proprietário", width: 96 },
  { header: "Validade", width: 48 },
  { header: "Localização", width: 60 },
  { header: "Situação do lote", width: 72 },
  { header: "Físico", width: 58, align: "right" },
  { header: "Reservado", width: 58, align: "right" },
  { header: "Disponível", width: 58, align: "right" },
  { header: "Un.", width: 28, align: "center" },
];

/**
 * Por que Disponível pode ser zero com Físico cheio.
 *
 * Lote aguardando liberação da Qualidade, bloqueado ou vencido continua no
 * Físico e não entra no Disponível. Sem a coluna de situação e sem este
 * aviso, a folha mostrava Físico 500 e Disponível 0 e quem estava no estoque
 * com o papel na mão não tinha como saber o motivo.
 */
const AVISO_DISPONIVEL =
  `Disponível = Físico − Reservado, e só conta lote com situação “${LOT_STATUS_LABELS.AVAILABLE}”. ` +
  `Lote “${LOT_STATUS_LABELS.AWAITING_RELEASE}”, “${LOT_STATUS_LABELS.BLOCKED}” ou ` +
  `“${LOT_STATUS_LABELS.EXPIRED}” continua no estoque físico e conta zero no disponível.`;

export function inventoryPositionPdfFileName(generatedAt: Date): string {
  return pdfFileName("FO-02", "posicao-estoque", diaDaEmissao(generatedAt));
}

/** Levantamento do estoque no momento da geração — não é snapshot legal. */
export function InventoryPositionPdf({
  rows,
  search,
  generatedAt,
  generatedBy,
}: Emissao & { rows: InventoryPositionRowDTO[]; search: string }) {
  return (
    <PdfDocument
      title="Posição / levantamento de estoque"
      code="FO-02"
      headerLines={[geradoPor(generatedBy)]}
      footerNote="Levantamento do estoque no momento da geração — não é snapshot legal."
      generatedAt={generatedAt}
      landscape
    >
      <FiltrosAplicados
        fields={[
          search ? { label: "Busca", value: search, span: 3 } : null,
          { label: "Linhas", value: String(rows.length), span: 3 },
        ]}
      />

      <PdfNotice>{AVISO_DISPONIVEL}</PdfNotice>

      <PdfSection title="Posição por item e lote">
        <PdfTable
          columns={COLUNAS_POSICAO}
          dense
          isEmpty={rows.length === 0}
          emptyMessage="Nenhum item no filtro aplicado."
        >
          {rows.map((row) => (
            <PdfTr key={`${row.itemId}-${row.lotId ?? "sem-lote"}`}>
              <PdfTd>{row.itemCode}</PdfTd>
              <PdfTd>{row.itemName}</PdfTd>
              <PdfTd>{orDash(row.lotCode)}</PdfTd>
              <PdfTd>{fornecedorOuProprietario(row)}</PdfTd>
              <PdfTd>{formatDate(row.expiryDate)}</PdfTd>
              <PdfTd>{orDash(row.location)}</PdfTd>
              <PdfTd>{situacaoDoLote(row.status, row.isExpired)}</PdfTd>
              <PdfTd>{formatQuantity(row.onHand)}</PdfTd>
              <PdfTd>{formatQuantity(row.reserved)}</PdfTd>
              <PdfTd>{formatQuantity(row.available)}</PdfTd>
              <PdfTd>{row.unitCode}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>
    </PdfDocument>
  );
}

/* ─────────────── FO-03 — Pendências de qualidade ─────────────── */

const COLUNAS_QUALIDADE: PdfColumn[] = [
  { header: "Lote", width: 82 },
  { header: "Item", flex: 1 },
  { header: "Fornecedor / proprietário", width: 96 },
  { header: "CoA", width: 76 },
  { header: "Qualidade", width: 66 },
  { header: "Validade", width: 48 },
  { header: "Recebido em", width: 58 },
  { header: "Pendência", width: 80 },
  { header: "Tratado / observação", width: 110 },
];

/** O que falta para o lote sair da fila, pela situação do laudo. */
function pendenciaDoLote(row: QualityQueueRowDTO): string {
  if (row.requiresCoa && row.coaStatus === "PENDING") return "Laudo não recebido";
  if (row.requiresCoa && row.coaStatus === "RECEIVED") return "Laudo aguardando análise";
  return "Aguardando liberação";
}

export function qualityPendingPdfFileName(generatedAt: Date): string {
  return pdfFileName("FO-03", "pendencias-qualidade", diaDaEmissao(generatedAt));
}

/**
 * Lista de pendências para tratar fisicamente. A coluna "Tratado /
 * observação" é papel: aprovar ou rejeitar CoA continua sendo ato da
 * Qualidade dentro do sistema, com usuário e data.
 */
export function QualityPendingPdf({
  rows,
  generatedAt,
  generatedBy,
}: Emissao & { rows: QualityQueueRowDTO[] }) {
  return (
    <PdfDocument
      title="Pendências de qualidade / CoA"
      code="FO-03"
      headerLines={[geradoPor(generatedBy)]}
      footerNote="Folha operacional de papel — aprovar ou rejeitar CoA é ato da Qualidade no sistema."
      generatedAt={generatedAt}
      landscape
    >
      <FiltrosAplicados fields={[{ label: "Lotes pendentes", value: String(rows.length), span: 3 }]} />

      <PdfSection title="Lotes a tratar">
        <PdfTable
          columns={COLUNAS_QUALIDADE}
          dense
          isEmpty={rows.length === 0}
          emptyMessage="Nenhuma pendência de qualidade."
        >
          {rows.map((row) => (
            <PdfTr key={row.lotId}>
              <PdfTd>{row.lotCode}</PdfTd>
              <PdfTd>
                {row.itemCode} — {row.itemName}
              </PdfTd>
              <PdfTd>{fornecedorOuProprietario(row)}</PdfTd>
              <PdfTd>{row.requiresCoa ? COA_STATUS_LABELS[row.coaStatus] : "Não exigido"}</PdfTd>
              <PdfTd>{LOT_STATUS_LABELS[row.lotStatus]}</PdfTd>
              <PdfTd>{formatDate(row.expiryDate)}</PdfTd>
              <PdfTd>{formatDate(row.receivedAt)}</PdfTd>
              <PdfTd>{pendenciaDoLote(row)}</PdfTd>
              <PdfTd>
                <PdfWriteLine />
              </PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSignatures fields={["Qualidade — responsável", "Data"]} />
    </PdfDocument>
  );
}

/* ─────────────── FO-04 — Picking da produção ─────────────── */

const COLUNAS_PICKING_OP: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Responsabilidade", width: 82 },
  { header: "Necessário", width: 70, align: "right" },
  { header: "Lote esperado", width: 82 },
  { header: "Validade", width: 48 },
  { header: "Localização", width: 60 },
  { header: "Qtd. separar", width: 70, align: "right" },
  // O papel continua com campo de conferência manual; o que o sistema já
  // sabe aparece na coluna ao lado, sem preencher o quadrado.
  { header: "Conferido (papel)", width: 52, align: "center" },
  { header: "Picking no sistema", width: 84 },
  { header: "Observação", width: 90 },
];

/** "OP 007/26" — número oficial quando existe; senão, a identidade interna. */
function contextoDaOp(order: Pick<ProductionOrderDTO, "code" | "officialNumber">): string {
  return order.officialNumber ? `OP ${order.officialNumber}` : order.code;
}

function pickingNoSistema(line: MaterialReservationLineDTO): string {
  return line.pickingStatus === "CONFIRMED"
    ? `${line.pickedBy ?? "—"}${line.pickedAt ? ` · ${formatDate(line.pickedAt)}` : ""}`
    : "—";
}

export function productionPickingPdfFileName(
  order: Pick<ProductionOrderDTO, "code" | "officialNumber">,
): string {
  return order.officialNumber ? pdfFileName("FO-04", "OP", order.officialNumber) : pdfFileName("FO-04", order.code);
}

/** Separação de material da OP. A conferência digital do picking continua. */
export function ProductionPickingPdf({
  order,
  generatedAt,
  generatedBy,
}: Emissao & { order: ProductionOrderDTO }) {
  const reservationLines = order.requirements.flatMap((requirement) =>
    requirement.reservationLines.map((line) => ({ requirement, line })),
  );

  return (
    <PdfDocument
      title="Folha de separação / picking da produção"
      code={`FO-04 · ${contextoDaOp(order)}`}
      headerLines={[geradoPor(generatedBy)]}
      footerNote="Folha operacional de papel — a conferência do picking continua no sistema."
      generatedAt={generatedAt}
      landscape
    >
      <PdfSection title="Ordem de produção">
        <PdfDataGrid
          fields={[
            // 2 + 3 + 7: a soma das larguras fecha a linha exata — 2 + 2 + 8
            // passava de 100% por arredondamento e o produto caía sozinho.
            { label: "OP", value: order.officialNumber ?? order.code, span: 2 },
            { label: "OP interna", value: order.code, span: 3 },
            { label: "Produto", value: `${order.productCode} — ${order.productName}`, span: 7 },
            { label: "Cliente", value: order.customerName ?? "—", span: 6 },
            {
              label: "Quantidade planejada",
              value: `${formatQuantity(order.plannedQuantity)} ${order.outputUnitCode}`,
              span: 3,
            },
            { label: "Situação", value: PRODUCTION_ORDER_STATUS_LABELS[order.status], span: 3 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Material a separar">
        <PdfTable
          columns={COLUNAS_PICKING_OP}
          dense
          isEmpty={reservationLines.length === 0}
          emptyMessage="Nenhuma reserva gerada — libere a OP para separar material."
        >
          {reservationLines.map(({ requirement, line }) => (
            <PdfTr key={line.id}>
              <PdfTd>
                {requirement.itemCode} — {requirement.itemName}
              </PdfTd>
              <PdfTd>{requirement.supplyResponsibility === "CUSTOMER" ? "Material do cliente" : "Veridi"}</PdfTd>
              <PdfTd>
                {formatQuantity(requirement.requiredQuantity)} {requirement.stockUnitCode}
              </PdfTd>
              <PdfTd>{orDash(line.lotCode)}</PdfTd>
              <PdfTd>{formatDate(line.expiryDate)}</PdfTd>
              <PdfTd>{orDash(line.location)}</PdfTd>
              <PdfTd>
                {formatQuantity(line.quantity)} {requirement.stockUnitCode}
              </PdfTd>
              <PdfTd>
                <PdfCheckBox />
              </PdfTd>
              <PdfTd>{pickingNoSistema(line)}</PdfTd>
              <PdfTd>
                <PdfWriteLine />
              </PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSignatures fields={["Separado por", "Conferido por", "Data"]} />
    </PdfDocument>
  );
}

/* ─────────────── FO-05 — Separação da expedição ─────────────── */

/**
 * A folha trazia a quantidade preenchida numa coluna e uma segunda coluna
 * "Qtd. separar" em branco — dois lugares para o mesmo número, e o que o
 * operador precisa ler saía vazio.
 *
 * A semântica da FO-05 é a mesma da FO-04: o sistema diz quanto separar, o
 * papel confirma. Uma coluna de quantidade, preenchida, e o visto de
 * conferência ao lado. Cabe em retrato.
 */
const COLUNAS_SEPARACAO_EXPEDICAO: PdfColumn[] = [
  { header: "Produto", flex: 1 },
  { header: "Qtd. separar", width: 64, align: "right" },
  { header: "Lote", width: 82 },
  { header: "Validade", width: 48 },
  { header: "Localização", width: 60 },
  { header: "Conferido", width: 50, align: "center" },
  { header: "Observação", width: 90 },
];

export function shipmentPickingPdfFileName(shipment: Pick<ShipmentDTO, "code">): string {
  return pdfFileName("FO-05", shipment.code);
}

/** Separação física da expedição — a conferência de lote no sistema continua obrigatória. */
export function ShipmentPickingPdf({
  shipment,
  generatedAt,
  generatedBy,
}: Emissao & { shipment: ShipmentDTO }) {
  return (
    <PdfDocument
      title="Folha de separação / expedição"
      code={`FO-05 · ${shipment.code}`}
      headerLines={[geradoPor(generatedBy)]}
      footerNote="Folha operacional de papel — a conferência de lote no sistema continua obrigatória."
      generatedAt={generatedAt}
    >
      <PdfSection title="Expedição">
        <PdfDataGrid
          fields={[
            { label: "Expedição", value: shipment.code, span: 3 },
            { label: "Pedido", value: shipment.customerOrderCode, span: 3 },
            { label: "Cliente", value: shipment.customerName, span: 6 },
            { label: "Situação", value: SHIPMENT_STATUS_LABELS[shipment.status], span: 3 },
            { label: "Emitida em", value: formatDate(shipment.createdAt), span: 3 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Produtos a separar">
        <PdfTable
          columns={COLUNAS_SEPARACAO_EXPEDICAO}
          dense
          isEmpty={shipment.lines.length === 0}
          emptyMessage="Nenhuma linha nesta expedição."
        >
          {shipment.lines.map((line) => (
            <PdfTr key={line.id}>
              <PdfTd>
                {line.productCode} — {line.productName}
              </PdfTd>
              <PdfTd>
                {formatQuantity(line.quantity)} {line.unitCode}
              </PdfTd>
              <PdfTd>{orDash(line.lotCode)}</PdfTd>
              <PdfTd>{formatDate(line.expiryDate)}</PdfTd>
              <PdfTd>{orDash(line.location)}</PdfTd>
              <PdfTd>
                <PdfCheckBox />
              </PdfTd>
              <PdfTd>
                <PdfWriteLine />
              </PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSignatures fields={["Separado por", "Conferido por", "Data"]} />
    </PdfDocument>
  );
}
