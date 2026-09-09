import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  ShipmentDTO,
  ShipmentLineDTO,
  ShipmentProductGroupDTO,
  ShipmentProductStatus,
  ShipmentStatus,
} from "@veridi/shared";
import {
  Decimal,
  SHIPMENT_BILLING_STATUS_LABELS,
  SHIPMENT_PRODUCT_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  previaDeExpedicaoDoProduto,
} from "@veridi/shared";
import {
  cancelShipment,
  confirmShipment,
  getShipment,
  updateShipment,
  verifyShipmentLine,
} from "../../lib/shipments-api";
import { createBilling } from "../../lib/billings-api";
import { FormSection } from "../../components/FormSection";
import { FlowContext } from "../../components/FlowContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { formatDate, formatDateTime } from "../../lib/dates";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { ModalDialog } from "../../components/ModalDialog";
import { formatQuantity } from "../../lib/quantity";
import { excedeLimiteExibido, resolverQuantidadeContraLimite } from "../../lib/quantity-limit";

/**
 * ⓘ de cabeçalho de coluna. O texto mora em `help-content`: “Reservado
 * disponível” quer dizer a mesma coisa aqui e no Pedido, e quem revisa a
 * explicação não deveria precisar abrir duas telas.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

function statusBadgeClass(status: ShipmentStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}


function productStatusBadgeClass(status: ShipmentProductStatus): string {
  switch (status) {
    case "VERIFIED":
      return "badge badge--active";
    case "PARTIAL":
      return "badge badge--warn";
    case "READY":
      return "badge badge--neutral";
    case "PENDING":
      return "badge badge--inactive";
  }
}

/**
 * O que a expedição faz com UM produto do pedido, lida da tela — antes de
 * confirmar e sem tocar em nada.
 *
 * Três conceitos que um "Total" único misturava: o que já saiu em expedições
 * confirmadas (histórico), o que sai NESTA (as linhas em edição, ao vivo) e o
 * que sobra do pedido depois. A conta é a função canônica de
 * `@veridi/shared`; aqui só se lê o que foi digitado. Quantidade ilegível não
 * entra e é contada — nunca vira zero em silêncio.
 */
/**
 * Um LOTE reservado na separação — e as promessas que a saída dele atende.
 *
 * Uma quantidade pode atravessar entregas programadas: 500 contra uma entrega
 * de 400 e outra de 600 atende as duas, e o servidor representa isso em duas
 * linhas de Expedição do MESMO lote e da MESMA reserva. Quem separa não vê
 * duas caixas — vê um lote e um número —, então a tela reagrupa por reserva e
 * mostra a associação de lado, como informação.
 */
export interface LoteDaSeparacao {
  reservationLineId: string;
  /** Todas as linhas de Expedição deste lote — uma por promessa atendida. */
  lineIds: string[];
  lotCode: string | null;
  businessLotNumber: string | null;
  expiryDate: string | null;
  location: string | null;
  unitCode: string;
  reservedRemaining: string;
  /** Soma das linhas: o que sai deste lote nesta expedição. */
  quantity: string;
  requiresVerification: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  /** As entregas programadas atendidas, na ordem em que foram servidas. */
  deliveries: { sequence: number; scheduledDate: string; quantity: string }[];
}

export function agruparPorReserva(lines: ShipmentLineDTO[]): LoteDaSeparacao[] {
  const porReserva = new Map<string, LoteDaSeparacao>();
  for (const line of lines) {
    const atual = porReserva.get(line.customerOrderReservationLineId);
    const entrega =
      line.deliverySequence !== null && line.deliveryScheduledDate !== null
        ? {
            sequence: line.deliverySequence,
            scheduledDate: line.deliveryScheduledDate,
            quantity: line.quantity,
          }
        : null;

    if (!atual) {
      porReserva.set(line.customerOrderReservationLineId, {
        reservationLineId: line.customerOrderReservationLineId,
        lineIds: [line.id],
        lotCode: line.lotCode,
        businessLotNumber: line.businessLotNumber,
        expiryDate: line.expiryDate,
        location: line.location,
        unitCode: line.unitCode,
        reservedRemaining: line.reservedRemaining,
        quantity: line.quantity,
        requiresVerification: line.requiresVerification,
        verifiedAt: line.verifiedAt,
        verifiedBy: line.verifiedBy,
        deliveries: entrega ? [entrega] : [],
      });
      continue;
    }

    atual.lineIds.push(line.id);
    atual.quantity = new Decimal(atual.quantity).plus(line.quantity).toString();
    atual.requiresVerification = atual.requiresVerification || line.requiresVerification;
    // Conferido é o LOTE: a leitura vale para todas as linhas dele, e uma
    // parte conferida com outra pendente seria uma conferência pela metade.
    if (!line.verifiedAt) {
      atual.verifiedAt = null;
      atual.verifiedBy = null;
    }
    if (entrega) atual.deliveries.push(entrega);
  }
  return [...porReserva.values()];
}

function previaDoProduto(
  group: ShipmentProductGroupDTO,
  lotes: LoteDaSeparacao[],
  quantities: Record<string, string>,
) {
  const legiveis: { id: string; reservedRemaining: string; quantity: string }[] = [];
  let ilegiveis = 0;
  for (const line of lotes) {
    const digitado = (quantities[line.reservationLineId] ?? "").trim();
    const legivel = digitado === "" ? "0" : parseDecimalInput(digitado);
    if (legivel === null) {
      ilegiveis += 1;
      continue;
    }
    legiveis.push({
      id: line.reservationLineId,
      reservedRemaining: line.reservedRemaining,
      quantity: legivel,
    });
  }
  const previa = previaDeExpedicaoDoProduto({
    outstandingQuantity: group.outstandingQuantity,
    linhas: legiveis,
  });
  return { ...previa, ilegiveis };
}

interface ProductGroupProps {
  group: ShipmentProductGroupDTO;
  lotes: LoteDaSeparacao[];
  isDraft: boolean;
  shipmentStatus: ShipmentStatus;
  quantities: Record<string, string>;
  onQuantityChange: (reservationLineId: string, value: string) => void;
  lotInputs: Record<string, string>;
  onLotInputChange: (reservationLineId: string, value: string) => void;
  onVerify: (lote: LoteDaSeparacao) => void;
  verifyingLine: string | null;
  /** Erro por linha (ex.: conferir sem informar o lote) — mostrado ao lado do campo. */
  lotErrors: Record<string, string>;
  registerLotInput: (reservationLineId: string, element: HTMLInputElement | null) => void;
}

/**
 * Um produto do Pedido dentro da Expedição. Um Pedido com vários produtos
 * gera vários blocos — inclusive para o produto que ainda não tem reserva,
 * para o operador enxergar o que falta. Nenhum total aqui é armazenado:
 * tudo vem derivado do read model.
 */
function ProductGroup({
  group,
  lotes,
  isDraft,
  shipmentStatus,
  quantities,
  onQuantityChange,
  lotInputs,
  onLotInputChange,
  onVerify,
  verifyingLine,
  lotErrors,
  registerLotInput,
}: ProductGroupProps) {
  return (
    <div className="shipment-product">
      <div className="status-line">
        <strong>
          <EntityLink kind="product" id={group.productId} code={group.productCode} name={group.productName} />
        </strong>
        <span className={productStatusBadgeClass(group.status)}>
          {SHIPMENT_PRODUCT_STATUS_LABELS[group.status]}
        </span>
      </div>

      {/*
        Cada número com a própria unidade — nada é somado entre produtos.

        No rascunho, "Expedindo agora" e "Restante após esta expedição" são
        PRÉVIA das linhas em edição, não o que está gravado: "Já expedido"
        é o histórico das expedições confirmadas, e os três não se misturam.
        Quantidade acima do que falta expedir não vira saldo negativo — vira
        erro dito, com a confirmação travada.
      */}
      {isDraft ? (
        (() => {
          const previa = previaDoProduto(group, lotes, quantities);
          const unidade = group.unitCode;
          return (
            <p className="shipment-product__meta" aria-live="polite">
              Quantidade do pedido: {formatQuantity(group.orderedQuantity)} {unidade} · Já expedido
              (antes desta): {formatQuantity(group.shippedQuantity)} {unidade} · Falta expedir:{" "}
              {formatQuantity(group.outstandingQuantity)} {unidade} · Reservado disponível:{" "}
              {formatQuantity(group.reservedRemaining)} {unidade} ·{" "}
              <strong>
                Expedindo agora (prévia): {formatQuantity(previa.expedindoAgora)} {unidade}
              </strong>{" "}
              ·{" "}
              {previa.acimaDoQueFalta ? (
                <span className="field__error">
                  Acima do que falta expedir em{" "}
                  {formatQuantity(previa.restanteDepois.replace("-", ""))} {unidade} — corrija a
                  separação.
                </span>
              ) : (
                <strong>
                  Restante após esta expedição: {formatQuantity(previa.restanteDepois)} {unidade}
                </strong>
              )}
              {previa.ilegiveis > 0 && (
                <span className="field__error">
                  {" "}
                  · {previa.ilegiveis === 1 ? "1 linha ilegível" : `${previa.ilegiveis} linhas ilegíveis`}{" "}
                  fora da prévia.
                </span>
              )}{" "}
              · Lotes conferidos: {group.lotsVerified}/{group.lotsRequired}
            </p>
          );
        })()
      ) : (
        <p className="shipment-product__meta">
          Quantidade do pedido: {formatQuantity(group.orderedQuantity)} {group.unitCode} ·{" "}
          {shipmentStatus === "CONFIRMED" ? "Expedido nesta expedição" : "Separado nesta expedição"}
          : {formatQuantity(group.shippingNow)} {group.unitCode} · Já expedido (total):{" "}
          {formatQuantity(group.shippedQuantity)} {group.unitCode} · Falta expedir:{" "}
          {formatQuantity(group.outstandingQuantity)} {group.unitCode} · Lotes conferidos:{" "}
          {group.lotsVerified}/{group.lotsRequired}
        </p>
      )}

      {lotes.length === 0 ? (
        <p className="field__hint">Ainda sem reserva disponível para esta expedição.</p>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Lote</th>
                <th>
                  Lote Veridi
                  <DicaDaColuna id="comercial.expedicaoLoteVeridi" />
                </th>
                <th>Validade</th>
                <th>Localização</th>
                <th className="is-numeric">
                  Reservado disponível
                  <DicaDaColuna id="comercial.expedicaoReservadoDisponivel" />
                </th>
                <th className="is-numeric">
                  {isDraft ? "Enviar agora" : "Expedido"}
                  {isDraft && <DicaDaColuna id="comercial.expedicaoEnviarAgora" />}
                </th>
                <th>
                  Conferência
                  <DicaDaColuna id="comercial.expedicaoConferencia" />
                </th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((line) => (
                <tr key={line.reservationLineId}>
                  <td className="is-code">
                    {line.lotCode ?? "—"}
                    {line.deliveries.length > 0 && (
                      <span className="field__hint">
                        {" "}
                        {line.deliveries
                          .map(
                            (entrega) =>
                              `Entrega ${entrega.sequence} · ${formatQuantity(entrega.quantity)}`,
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td>{line.businessLotNumber ?? "—"}</td>
                  <td>{formatDate(line.expiryDate)}</td>
                  <td>{line.location ?? "—"}</td>
                  <td className="is-numeric">
                    {formatQuantity(line.reservedRemaining)} {line.unitCode}
                  </td>
                  <td className="is-numeric">
                    {isDraft ? (
                      (() => {
                        /* O campo aceitava 100 enquanto o resumo dizia 98,
                           e o servidor expedia 98 em silêncio: dois números
                           na mesma tela, um deles falso. O teto agora é
                           dito antes, não descoberto depois. */
                        const digitado = (
                          quantities[line.reservationLineId] ?? ""
                        ).trim();
                        const legivel = parseDecimalInput(digitado);
                        const ilegivel = digitado !== "" && legivel === null;
                        /* O teto exibido é resumido e o real tem doze casas:
                           digitar o número que a tela mostra é pedir tudo o
                           que está reservado, não passar dele. */
                        const excede = excedeLimiteExibido(digitado, line.reservedRemaining);
                        return (
                          <>
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Quantidade do lote ${line.lotCode ?? ""}`}
                              aria-invalid={excede || ilegivel || undefined}
                              className={excede || ilegivel ? "is-invalid" : undefined}
                              value={quantities[line.reservationLineId] ?? ""}
                              onChange={(event) =>
                                onQuantityChange(line.reservationLineId, event.target.value)
                              }
                            />
                            {ilegivel && (
                              <p className="field__error">{mensagemDecimalInvalido("Quantidade")}</p>
                            )}
                            {excede && (
                              <p className="field__error">
                                Máximo {formatQuantity(line.reservedRemaining)} {line.unitCode} — é o
                                que está reservado a este pedido.
                              </p>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      `${formatQuantity(line.quantity)} ${line.unitCode}`
                    )}
                  </td>
                  <td>
                    {line.verifiedAt ? (
                      <span className="status-line">
                        <span className="badge badge--active">Conferido</span>
                        <span className="field__hint">
                          {formatDateTime(line.verifiedAt)} — {line.verifiedBy ?? "—"}
                        </span>
                      </span>
                    ) : isDraft && line.requiresVerification ? (
                      <>
                        <div className="lot-scanner__manual-row">
                          <input
                            ref={(element) =>
                              registerLotInput(line.reservationLineId, element)
                            }
                            type="text"
                            aria-label={`Lote conferido da linha ${line.lotCode ?? ""}`}
                            placeholder="Escaneie ou digite o lote"
                            aria-invalid={
                              lotErrors[line.reservationLineId] ? true : undefined
                            }
                            aria-describedby={
                              lotErrors[line.reservationLineId]
                                ? `lot-error-${line.reservationLineId}`
                                : undefined
                            }
                            value={lotInputs[line.reservationLineId] ?? ""}
                            onChange={(event) =>
                              onLotInputChange(
                                line.reservationLineId,
                                event.target.value,
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") onVerify(line);
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={verifyingLine === line.reservationLineId}
                            onClick={() => onVerify(line)}
                          >
                            {verifyingLine === line.reservationLineId
                              ? "Conferindo…"
                              : "Conferir lote"}
                          </button>
                        </div>
                        {/* O erro veio de um clique explícito: precisa ser texto
                            visível, não só tooltip. */}
                        {lotErrors[line.reservationLineId] && (
                          <p
                            id={`lot-error-${line.reservationLineId}`}
                            className="form-alert form-alert--inline"
                            role="alert"
                          >
                            {lotErrors[line.reservationLineId]}
                          </p>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Documento transacional — página própria no workspace, não
 * FullWorkspaceModal. Estruturada como bloco read-only quando CONFIRMED,
 * para que a versão de impressão futura seja um recorte direto desta tela.
 */
export function ShipmentPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [preparingBilling, setPreparingBilling] = useState(false);

  /** Código lido/digitado por linha de reserva (a linha é recriada a cada save). */
  const [lotInputs, setLotInputs] = useState<Record<string, string>>({});
  const [verifyingLine, setVerifyingLine] = useState<string | null>(null);
  const [lotErrors, setLotErrors] = useState<Record<string, string>>({});
  const lotInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const syncFromServer = useCallback((next: ShipmentDTO) => {
    setShipment(next);
    setNotes(next.notes ?? "");
    /* Uma reserva pode ter mais de uma linha quando a quantidade atravessa
       entregas programadas. O campo é do LOTE, então ele recebe a SOMA — pegar
       a última linha mostraria 100 onde saem 500. */
    const nextQuantities: Record<string, string> = {};
    for (const line of next.lines) {
      const atual = nextQuantities[line.customerOrderReservationLineId];
      nextQuantities[line.customerOrderReservationLineId] = atual
        ? new Decimal(atual).plus(line.quantity).toString()
        : line.quantity;
    }
    setQuantities(nextQuantities);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    getShipment(id)
      .then(syncFromServer)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, syncFromServer]);

  const isDraft = shipment?.status === "DRAFT";

  /* As três gravações da expedição montam a mesma lista, e ela precisa ser a
     mesma conta: quem digitou o reservado que a tela mostra está expedindo a
     reserva INTEIRA, então vai o valor canônico, com toda a precisão. Enviar
     o texto resumido criaria expedição a mais ou a menos por arredondamento
     de exibição. */
  function linhasParaEnvio(): { customerOrderReservationLineId: string; quantity: string }[] {
    if (!shipment) return [];
    /* Uma entrada por RESERVA, não por linha: o split em duas linhas é
       representação do servidor, e reenviá-lo como duas entradas duplicaria a
       quantidade do lote. O servidor reparte de novo a partir do total. */
    return agruparPorReserva(shipment.lines).map((line) => {
      const digitado = quantities[line.reservationLineId] ?? "0";
      const resolvido = resolverQuantidadeContraLimite(digitado, line.reservedRemaining);
      return {
        customerOrderReservationLineId: line.reservationLineId,
        quantity:
          resolvido.status === "ok"
            ? resolvido.valorCanonico
            : (exigirDecimalOpcional(digitado, "Quantidade") ?? "0"),
      };
    });
  }

  async function handleSave() {
    if (!id || !shipment) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateShipment(id, {
        notes: notes.trim(),
        lines: linhasParaEnvio(),
      });
      syncFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar expedição");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!id) return;
    setConfirmDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      // Confirma o que está na tela antes de efetivar a saída física.
      if (shipment) {
        await updateShipment(id, {
          notes: notes.trim(),
          lines: linhasParaEnvio(),
        });
      }
      const confirmed = await confirmShipment(id);
      syncFromServer(confirmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar expedição");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Confere o lote de uma linha. A separação é salva antes, porque a
   * conferência valida a quantidade realmente gravada — e como o save
   * recria as linhas, a conferência usa o id devolvido pelo servidor.
   */
  async function handleVerify(lote: LoteDaSeparacao) {
    if (!id || !shipment) return;
    const reservationLineId = lote.reservationLineId;
    const lotCode = (lotInputs[reservationLineId] ?? "").trim();

    // Campo vazio não chama o backend — mas também não pode ser um clique
    // sem resposta: mensagem visível na linha e foco de volta no campo.
    if (!lotCode) {
      setLotErrors((prev) => ({
        ...prev,
        [reservationLineId]: "Informe ou escaneie o lote antes de conferir.",
      }));
      lotInputRefs.current[reservationLineId]?.focus();
      return;
    }

    setLotErrors((prev) => {
      const next = { ...prev };
      delete next[reservationLineId];
      return next;
    });
    setVerifyingLine(reservationLineId);
    setError(null);
    try {
      const saved = await updateShipment(id, {
        notes: notes.trim(),
        lines: linhasParaEnvio(),
      });
      /* Conferir é do LOTE. Quando a quantidade dele atravessa entregas
         programadas ele tem mais de uma linha, e conferir só a primeira
         deixaria a expedição sem confirmar por uma linha invisível. */
      const alvos = saved.lines.filter(
        (current) => current.customerOrderReservationLineId === reservationLineId,
      );
      if (alvos.length === 0) {
        syncFromServer(saved);
        setError("Esta linha não está mais na separação — informe a quantidade antes de conferir.");
        return;
      }

      let verified = saved;
      for (const alvo of alvos) {
        verified = await verifyShipmentLine(id, alvo.id, { lotCode });
      }
      syncFromServer(verified);
      setLotInputs((prev) => ({ ...prev, [reservationLineId]: "" }));
    } catch (err) {
      // Lote errado: mensagem real do backend, junto do campo, e o que foi
      // digitado continua lá para o operador comparar e corrigir.
      const message = err instanceof Error ? err.message : "Falha ao conferir o lote";
      setLotErrors((prev) => ({ ...prev, [reservationLineId]: message }));
      lotInputRefs.current[reservationLineId]?.focus();
    } finally {
      setVerifyingLine(null);
    }
  }

  async function handleCancel() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const cancelled = await cancelShipment(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      syncFromServer(cancelled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar expedição");
    } finally {
      setSaving(false);
    }
  }

  async function handlePrepareBilling() {
    if (!shipment) return;
    if (shipment.billingId) {
      navigate(`/comercial/faturamento/${shipment.billingId}`);
      return;
    }
    setPreparingBilling(true);
    setError(null);
    try {
      const billing = await createBilling(shipment.id);
      navigate(`/comercial/faturamento/${billing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar faturamento");
    } finally {
      setPreparingBilling(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Expedição</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !shipment) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Expedição não encontrada</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/expedicoes")}>
            ← Voltar para Expedições
          </button>
        </div>
      </div>
    );
  }

  /*
   * A prévia de cada produto, pela função canônica — e é dela que saem as
   * guardas da confirmação: nada a enviar, linha acima do reservado, produto
   * acima do que falta expedir. Um "Total" único somava quantidades de
   * produtos diferentes, em unidades diferentes, e saía cru na tela.
   */
  const previasPorProduto = shipment.products.map((group) =>
    previaDoProduto(
      group,
      agruparPorReserva(
        shipment.lines.filter((line) => line.customerOrderLineId === group.customerOrderLineId),
      ),
      quantities,
    ),
  );
  /* Gate do envio: quantidade é comparada em `Decimal`, não por `Number` — §66. */
  const algoAEnviar = previasPorProduto.some((previa) =>
    new Decimal(previa.expedindoAgora).greaterThan(0),
  );
  const produtosAcimaDoQueFalta = previasPorProduto.filter((previa) => previa.acimaDoQueFalta);

  /* Quantidade que a tela não consegue ler não vira zero em silêncio. */
  const linhasIlegiveis = agruparPorReserva(shipment.lines).filter((line) => {
    const digitado = (quantities[line.reservationLineId] ?? "").trim();
    return digitado !== "" && parseDecimalInput(digitado) === null;
  });

  /* Confirmar não corrige silenciosamente para o teto: enquanto houver
     linha acima do reservado, a ação fica bloqueada e a linha diz por quê. */
  const linhasAcimaDoReservado = agruparPorReserva(shipment.lines).filter((line) =>
    excedeLimiteExibido(
      quantities[line.reservationLineId] ?? "",
      line.reservedRemaining,
    ),
  );

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs
            items={[
              { label: "Expedições", href: "/comercial/expedicoes" },
              { label: shipment.code },
            ]}
          />
          <div className="doc-title">
            <h1>{shipment.code}</h1>
            <span className={statusBadgeClass(shipment.status)}>
              {SHIPMENT_STATUS_LABELS[shipment.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/comercial/expedicoes/${shipment.id}/imprimir`)}
          >
            Imprimir
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/print/expedicao-separacao/${shipment.id}`)}
          >
            Folha de separação (FO-05)
          </button>
        </div>
      </div>

      <FlowContext
        steps={[
          {
            kind: "Pedido",
            code: shipment.customerOrderCode,
            path: `/comercial/pedidos/${shipment.customerOrderId}`,
            detail: shipment.customerName,
          },
          { kind: "Expedição", code: shipment.code, current: true },
          ...(shipment.billingId && shipment.billingCode
            ? [
                {
                  kind: "Faturamento",
                  code: shipment.billingCode,
                  path: `/comercial/faturamento/${shipment.billingId}`,
                },
              ]
            : []),
        ]}
      />

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Separar, conferir e expedir são três atos diferentes na mesma
            tela, e só o último move estoque — sem volta. */}
        <ContextHelp topic={helpTopics["comercial.expedicao"]} />

        {shipment.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelada</span>
              <span className="field__hint">
                {formatDateTime(shipment.cancelledAt)} — {shipment.cancelledBy ?? "—"}
              </span>
            </div>
            {shipment.cancelReason && <p className="field__hint">Motivo: {shipment.cancelReason}</p>}
          </FormSection>
        )}

        <FormSection title="Pedido">
          <dl className="definition-list">
            <dt>Pedido</dt>
            <dd>
              <Link
                className="btn btn--ghost btn--sm"
                to={`/comercial/pedidos/${shipment.customerOrderId}`}
              >
                {shipment.customerOrderCode}
              </Link>
            </dd>
            <dt>Cliente</dt>
            <dd>
              <EntityLink
                kind="customer"
                id={shipment.customerId}
                code={shipment.customerName}
              />
            </dd>
            <dt>Data da expedição</dt>
            <dd>{formatDate(shipment.shipmentDate)}</dd>
          </dl>
        </FormSection>

        {isDraft && (
          <FormSection
            title="Conferência"
            subtitle="Cada lote é conferido uma vez — nunca por unidade. Conferir não movimenta estoque."
          >
            <dl className="definition-list">
              <dt>Produtos nesta expedição</dt>
              <dd>{shipment.verification.productCount}</dd>
              <dt>Lotes necessários</dt>
              <dd>{shipment.verification.lotsRequired}</dd>
              <dt>Lotes conferidos</dt>
              <dd>
                {shipment.verification.lotsVerified} / {shipment.verification.lotsRequired}
                {shipment.verification.allLotsVerified && shipment.verification.lotsRequired > 0 && " ✓"}
              </dd>
            </dl>
          </FormSection>
        )}

        <FormSection
          title="Itens para expedição"
          subtitle={
            isDraft
              ? "Separação — nada sai do estoque até a confirmação. Só é possível expedir o que está reservado a este pedido."
              : "Quantidades efetivamente expedidas — histórico imutável."
          }
        >
          {shipment.products.map((group) => (
            <ProductGroup
              key={group.customerOrderLineId}
              group={group}
              lotes={agruparPorReserva(
                shipment.lines.filter(
                  (line) => line.customerOrderLineId === group.customerOrderLineId,
                ),
              )}
              isDraft={isDraft}
              shipmentStatus={shipment.status}
              quantities={quantities}
              onQuantityChange={(reservationLineId, value) =>
                setQuantities((prev) => ({ ...prev, [reservationLineId]: value }))
              }
              lotInputs={lotInputs}
              onLotInputChange={(reservationLineId, value) =>
                setLotInputs((prev) => ({ ...prev, [reservationLineId]: value }))
              }
              onVerify={handleVerify}
              lotErrors={lotErrors}
              registerLotInput={(reservationLineId, element) => {
                lotInputRefs.current[reservationLineId] = element;
              }}
              verifyingLine={verifyingLine}
            />
          ))}

          {shipment.products.length === 0 && (
            <p className="field__hint">Nenhum item nesta expedição.</p>
          )}

        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="shipment-notes">Notas internas</label>
            <textarea
              id="shipment-notes"
              rows={3}
              disabled={!isDraft}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>

        {shipment.status === "CONFIRMED" && (
          <FormSection
            title="Faturamento"
            subtitle="Faturamento comercial/operacional — não emite Nota Fiscal e não movimenta estoque."
          >
            <div className="status-line">
              <span
                className={
                  shipment.billingStatus === "ISSUED"
                    ? "badge badge--active"
                    : shipment.billingStatus === "DRAFT"
                      ? "badge badge--warn"
                      : "badge badge--neutral"
                }
              >
                {SHIPMENT_BILLING_STATUS_LABELS[shipment.billingStatus]}
              </span>
              {shipment.billingCode && <span className="field__hint">{shipment.billingCode}</span>}
            </div>

            <div className="line-actions">
              <button
                type="button"
                className={shipment.billingId ? "btn btn--ghost btn--sm" : "btn btn--accent btn--sm"}
                disabled={preparingBilling}
                onClick={handlePrepareBilling}
              >
                {shipment.billingId
                  ? `Abrir ${shipment.billingCode}`
                  : preparingBilling
                    ? "Preparando…"
                    : "Preparar faturamento"}
              </button>
            </div>
          </FormSection>
        )}

        {shipment.status === "CONFIRMED" && (
          <FormSection
            title="Auditoria"
            subtitle="Conferência física e saída — histórico imutável, não é possível reconferir."
          >
            <dl className="definition-list">
              <dt>Confirmada em</dt>
              <dd>
                {formatDateTime(shipment.confirmedAt)} — {shipment.confirmedBy ?? "—"}
              </dd>
            </dl>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Lote</th>
                    <th>Lote Veridi</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Conferido em</th>
                    <th>Conferido por</th>
                  </tr>
                </thead>
                <tbody>
                  {shipment.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                      </td>
                      <td className="is-code">{line.lotCode ?? "—"}</td>
                      <td>{line.businessLotNumber ?? "—"}</td>
                      <td className="is-numeric">
                        {formatQuantity(line.quantity)} {line.unitCode}
                      </td>
                      <td>{formatDateTime(line.verifiedAt)}</td>
                      <td>{line.verifiedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}
      </div>

      <div className="doc-actions">
        {isDraft && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={saving}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar expedição
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSave}>
                {saving ? "Salvando…" : "Salvar separação"}
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={
                  saving ||
                  !algoAEnviar ||
                  linhasAcimaDoReservado.length > 0 ||
                  produtosAcimaDoQueFalta.length > 0 ||
                  linhasIlegiveis.length > 0 ||
                  !shipment.verification.allLotsVerified
                }
                onClick={() => setConfirmDialogOpen(true)}
                title={
                  linhasIlegiveis.length > 0
                    ? mensagemDecimalInvalido("Quantidade")
                    : linhasAcimaDoReservado.length > 0
                      ? "Há quantidade acima do reservado — corrija antes de confirmar."
                      : produtosAcimaDoQueFalta.length > 0
                        ? "Há produto acima do que falta expedir — corrija antes de confirmar."
                        : !algoAEnviar
                          ? "Nenhuma quantidade a expedir."
                          : shipment.verification.allLotsVerified
                            ? undefined
                            : "Existem lotes ainda não conferidos nesta expedição."
                }
              >
                Confirmar expedição
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        title={`Confirmar expedição ${shipment.code}?`}
        message={
          `Produtos: ${shipment.verification.productCount} · Lotes: ${shipment.verification.lotsRequired} · ` +
          `Conferência: ${shipment.verification.lotsVerified}/${shipment.verification.lotsRequired} ✓. ` +
          "A confirmação registrará a saída física do estoque e não poderá ser cancelada depois."
        }
        confirmLabel="Confirmar"
        confirmTone="accent"
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      {cancelDialogOpen && (
        <>
          <ModalDialog labelledBy="cancel-shipment-title" onClose={() => setCancelDialogOpen(false)}>
            <h2 id="cancel-shipment-title">Cancelar expedição?</h2>
            <p>
              {shipment.code} permanecerá no histórico. Nada sai do estoque — a reserva do pedido
              continua intacta e uma nova expedição pode ser preparada depois.
            </p>
            <div className="field">
              <label htmlFor="shipment-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="shipment-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setCancelDialogOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelReason.trim().length < 3 || saving}
                onClick={handleCancel}
              >
                Cancelar expedição
              </button>
            </div>
          </ModalDialog>
        </>
      )}
    </>
  );
}
