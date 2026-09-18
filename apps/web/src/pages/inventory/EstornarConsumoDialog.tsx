import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { InternalConsumptionDetailDTO, InternalConsumptionReversalDTO } from "@veridi/shared";
import {
  COST_SOURCE_LABELS,
  INTERNAL_CONSUMPTION_REVERSAL_REASON_MAX,
  INTERNAL_CONSUMPTION_REVERSAL_REASON_MIN,
  SEM_DESTINO_INFORMADO,
} from "@veridi/shared";
import { ModalDialog } from "../../components/ModalDialog";
import { DecimalField } from "../../components/NumericField";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDateTime } from "../../lib/dates";
import { mensagemNumeroVazio } from "../../lib/decimal-field";
import {
  createInternalConsumptionReversal,
  getInternalConsumption,
} from "../../lib/internal-consumption-api";
import {
  formatIntegerPtBr,
  formatMoneyPtBr,
  numericInvalidMessage,
  parsePtBrNumber,
  toPtBrEditText,
} from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import { formatQuantityWithUnit } from "../../lib/quantity";

/**
 * Estornar um consumo interno — INTERNAL-CONSUMPTION-REVERSAL-01.
 *
 * O diálogo lê o consumo NA HORA (o "já estornado" que ele mostra é o que vai
 * no `expectedReversedQuantity`): se outra aba estornou antes, o servidor
 * recusa em vez de estornar duas vezes. A quantidade começa no saldo
 * estornável; o motivo é obrigatório. Quem é o autor e qual lote recebe a
 * devolução não se escolhe aqui: são a sessão e o lote do próprio consumo.
 *
 * Os avisos (lote bloqueado ou vencido, item inativo, ajuste manual posterior)
 * não bloqueiam — dizem o que vai acontecer. As recusas do servidor aparecem
 * inteiras, porque é nelas que está o código do inventário que as causou.
 */
export function EstornarConsumoDialog({
  consumoId,
  consumoCode,
  onClose,
  onEstornado,
}: {
  consumoId: string;
  /** Para o título enquanto o consumo carrega. */
  consumoCode: string;
  onClose: () => void;
  onEstornado: (estorno: InternalConsumptionReversalDTO) => void;
}) {
  const [consumo, setConsumo] = useState<InternalConsumptionDetailDTO | null>(null);
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    getInternalConsumption(consumoId)
      .then((lido) => {
        if (!vivo) return;
        setConsumo(lido);
        // Padrão = o saldo estornável inteiro, o caso mais comum (lançamento indevido).
        setQuantidade(toPtBrEditText(lido.reversibleQuantity, { scale: CASAS_QUANTIDADE }));
      })
      .catch((falha: unknown) => {
        if (vivo) setErroDaLeitura(apiErrorMessage(falha, "Falha ao carregar o consumo"));
      });
    return () => {
      vivo = false;
    };
  }, [consumoId]);

  const leitura = parsePtBrNumber(quantidade, OPCOES_QUANTIDADE);
  const quantidadeCanonica = leitura.tipo === "valido" ? leitura.valor : null;
  const erroDaQuantidade =
    leitura.tipo === "invalido" ? numericInvalidMessage("Quantidade a estornar", leitura.motivo, OPCOES_QUANTIDADE) : null;
  const motivoLimpo = motivo.trim();
  // A situação vem do servidor, pela soma — a tela não refaz a conta.
  const semSaldo = consumo !== null && consumo.reversalStatus === "REVERSED";
  const podeConfirmar =
    consumo !== null &&
    !semSaldo &&
    quantidadeCanonica !== null &&
    motivoLimpo.length >= INTERNAL_CONSUMPTION_REVERSAL_REASON_MIN &&
    !salvando;

  async function confirmar(evento: FormEvent) {
    evento.preventDefault();
    if (!consumo) return;
    if (quantidadeCanonica === null) {
      setErro(erroDaQuantidade ?? mensagemNumeroVazio("Quantidade a estornar"));
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const estorno = await createInternalConsumptionReversal(consumo.id, {
        quantity: quantidadeCanonica,
        reason: motivoLimpo,
        expectedReversedQuantity: consumo.reversedQuantity,
      });
      onEstornado(estorno);
    } catch (falha) {
      // A recusa inteira — inventário aberto ou contado depois, saldo mudado.
      setErro(apiErrorMessage(falha, "Falha ao estornar o consumo"));
    } finally {
      setSalvando(false);
    }
  }

  const unidade = consumo?.uomCode;

  return (
    <ModalDialog labelledBy="estornar-consumo-titulo" onClose={onClose}>
      <h2 id="estornar-consumo-titulo">Estornar {consumo?.code ?? consumoCode}</h2>
      <p>
        Devolve ao estoque a quantidade que este consumo baixou por engano. O consumo continua no histórico; o
        estorno é um lançamento novo, com motivo e o seu nome.
      </p>

      {!consumo && !erroDaLeitura && <p role="status">Carregando o consumo…</p>}
      {erroDaLeitura && (
        <p className="form-alert" role="alert">
          {erroDaLeitura}
        </p>
      )}

      {consumo && (
        <>
          <dl className="definition-list">
            <div>
              <dt>Item</dt>
              <dd>
                {consumo.itemCode} — {consumo.itemName}
              </dd>
            </div>
            <div>
              <dt>Lote</dt>
              <dd>{consumo.lotCode ?? "—"}</dd>
            </div>
            <div>
              <dt>Data do consumo</dt>
              <dd>{formatDateTime(consumo.occurredAt)}</dd>
            </div>
            <div>
              <dt>Destino/uso</dt>
              <dd>{consumo.purpose ?? SEM_DESTINO_INFORMADO}</dd>
            </div>
            <div>
              <dt>Quantidade original</dt>
              <dd>{formatQuantityWithUnit(consumo.quantity, unidade)}</dd>
            </div>
            <div>
              <dt>Já estornado</dt>
              <dd>{formatQuantityWithUnit(consumo.reversedQuantity, unidade)}</dd>
            </div>
            <div>
              <dt>Saldo estornável</dt>
              <dd>{formatQuantityWithUnit(consumo.reversibleQuantity, unidade)}</dd>
            </div>
            <div>
              <dt>Custo original</dt>
              <dd>
                {consumo.unitCost === null ? (
                  "Custo não disponível — o estorno também fica sem custo."
                ) : (
                  <>
                    {formatMoneyPtBr(consumo.unitCost, { scale: 4 })}/{unidade} · total{" "}
                    {formatMoneyPtBr(consumo.totalCost, { scale: 2 })}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Fonte do custo</dt>
              <dd>
                {COST_SOURCE_LABELS[consumo.costSource]}
                {consumo.costDetails ? ` — ${consumo.costDetails}` : ""}
              </dd>
            </div>
          </dl>
          <p className="field__hint">
            O estorno usa o custo deste consumo, nunca o de hoje: uma compra posterior não muda o valor devolvido.
          </p>

          <AvisosDoEstorno consumo={consumo} />

          {semSaldo ? (
            <p className="callout" role="status">
              Não há quantidade a estornar: este consumo já foi estornado por inteiro.
            </p>
          ) : (
            <form id="estornar-consumo-form" onSubmit={confirmar} className="field-grid-2">
              <div className="field">
                <label htmlFor="estorno-quantidade">
                  Quantidade a estornar ({unidade}) <span className="req">*</span>
                </label>
                <DecimalField
                  id="estorno-quantidade"
                  scale={CASAS_QUANTIDADE}
                  placeholder="0"
                  value={quantidade}
                  onChangeValue={setQuantidade}
                  aria-invalid={erroDaQuantidade !== null || undefined}
                />
                {erroDaQuantidade && <p className="field__error">{erroDaQuantidade}</p>}
                <span className="field__hint">
                  Até {formatQuantityWithUnit(consumo.reversibleQuantity, unidade)}. Parcial é permitido.
                </span>
              </div>
              <div className="field field--full">
                <label htmlFor="estorno-motivo">
                  Motivo <span className="req">*</span>
                </label>
                <textarea
                  id="estorno-motivo"
                  rows={3}
                  maxLength={INTERNAL_CONSUMPTION_REVERSAL_REASON_MAX}
                  value={motivo}
                  onChange={(evento) => setMotivo(evento.target.value)}
                />
                <span className="field__hint">
                  Obrigatório, de {INTERNAL_CONSUMPTION_REVERSAL_REASON_MIN} a {INTERNAL_CONSUMPTION_REVERSAL_REASON_MAX}{" "}
                  caracteres.
                </span>
              </div>
            </form>
          )}

          <section aria-labelledby="estornos-anteriores">
            <h3 id="estornos-anteriores">Estornos anteriores</h3>
            {consumo.reversals.length === 0 ? (
              <p>Nenhum estorno anterior.</p>
            ) : (
              <ul className="confirm-dialog__list">
                {consumo.reversals.map((anterior) => (
                  <li key={anterior.id}>
                    <strong>{anterior.code}</strong> · {formatDateTime(anterior.createdAt)} ·{" "}
                    {formatQuantityWithUnit(anterior.quantity, anterior.uomCode)} · {anterior.registeredByName} · “
                    {anterior.reason}”
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}

      <div className="confirm-dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancelar
        </button>
        {consumo && !semSaldo && (
          <button type="submit" form="estornar-consumo-form" className="btn btn--accent" disabled={!podeConfirmar}>
            {salvando ? "Estornando…" : "Confirmar estorno"}
          </button>
        )}
      </div>
    </ModalDialog>
  );
}

/**
 * O que vai acontecer além da devolução — nenhum destes bloqueia.
 *
 * O lote nunca muda de situação por causa do estorno: a quantidade volta a
 * ele e o físico sobe, mas o disponível continua obedecendo à Qualidade e à
 * validade. Ajuste manual posterior pode já ter corrigido o erro, e o sistema
 * não tem como saber: quem estorna confere.
 */
function AvisosDoEstorno({ consumo }: { consumo: InternalConsumptionDetailDTO }) {
  const avisos: string[] = [];
  const situacoesDoLote: string[] = [];
  if (consumo.lotStatus === "BLOCKED") situacoesDoLote.push("bloqueado");
  if (consumo.lotStatus === "AWAITING_RELEASE") situacoesDoLote.push("aguardando liberação da Qualidade");
  if (consumo.lotExpired || consumo.lotStatus === "EXPIRED") situacoesDoLote.push("vencido");
  if (consumo.lotCode && situacoesDoLote.length > 0) {
    avisos.push(
      `O lote ${consumo.lotCode} está ${situacoesDoLote.join(" e ")}: a quantidade volta a ele e continua indisponível.`,
    );
  }
  if (!consumo.itemActive) {
    avisos.push(
      "Item inativo: o estorno devolve a quantidade mesmo assim — é a anulação de uma saída, não uma entrada nova.",
    );
  }
  const ajustes = consumo.laterManualAdjustmentCount;
  if (avisos.length === 0 && ajustes === 0) return null;

  return (
    <div className="callout" role="note">
      {avisos.map((aviso) => (
        <p key={aviso}>{aviso}</p>
      ))}
      {ajustes > 0 && (
        <>
          <p>
            Depois deste consumo {ajustes === 1 ? "houve 1 ajuste manual" : `houve ${formatIntegerPtBr(ajustes)} ajustes manuais`}{" "}
            de entrada nesta posição. O sistema não sabe se algum deles já corrigiu este consumo: confira antes de
            estornar.
          </p>
          <ul className="confirm-dialog__list">
            {consumo.laterManualAdjustments.map((ajuste) => (
              <li key={ajuste.id}>
                {formatDateTime(ajuste.occurredAt)} · {formatQuantityWithUnit(ajuste.quantity, consumo.uomCode)}
                {ajuste.createdBy ? ` · ${ajuste.createdBy}` : ""}
                {ajuste.reason ? ` · “${ajuste.reason}”` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
