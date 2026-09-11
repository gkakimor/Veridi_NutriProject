import { useState } from "react";
import type { QuoteDuplicatePriceStrategy, QuoteVersionDTO } from "@veridi/shared";
import { QUOTE_DUPLICATE_PRICE_STRATEGY_LABELS, QUOTE_STATUS_LABELS } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/**
 * Duplicar como nova versão — QUOTE-DUPLICATE-01, `PRODUCT_RULES.md` §85.
 *
 * A pergunta de preço é obrigatória e nada vem marcado: um padrão seria a
 * herança silenciosa de volta, com um passo a mais. A origem aparece com o
 * estado real dela, e proposta enviada ou recusada é dita como o que é —
 * preço oferecido, não acordo.
 *
 * Quem abre monta o diálogo com `key` da origem: cada abertura começa sem
 * escolha.
 */

interface Props {
  /** A versão que está sendo lida — `null` fecha o diálogo. */
  source: QuoteVersionDTO | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (priceStrategy: QuoteDuplicatePriceStrategy) => void;
}

export function DuplicateQuoteDialog({ source, saving, onCancel, onConfirm }: Props) {
  const [estrategia, setEstrategia] = useState<QuoteDuplicatePriceStrategy | null>(null);
  const versao = source ? `V${source.versionNumber}` : "";
  const acordo = source?.status === "ACCEPTED";

  const opcao = (valor: QuoteDuplicatePriceStrategy, explicacao: string) => (
    <label className="confirm-dialog__choice">
      <input
        type="radio"
        name="duplicar-precos"
        value={valor}
        checked={estrategia === valor}
        onChange={() => setEstrategia(valor)}
      />
      <span>
        <strong>{QUOTE_DUPLICATE_PRICE_STRATEGY_LABELS[valor]}</strong>
        <br />
        <span className="field__hint">{explicacao}</span>
      </span>
    </label>
  );

  return (
    <ConfirmDialog
      open={source !== null}
      title="Duplicar como nova versão"
      confirmLabel="Criar nova versão"
      confirmTone="accent"
      confirmDisabled={estrategia === null || saving}
      message={
        source && (
          <>
            <p>{`Nova versão baseada na ${versao} · ${QUOTE_STATUS_LABELS[source.status]}.`}</p>
            <p>
              A {versao} não muda. A versão nova nasce em rascunho, com os mesmos produtos,
              quantidades, unidades e condições comerciais — a validade só vem se ainda estiver
              vigente.
            </p>
            <fieldset className="field">
              <legend>Como deseja tratar os preços?</legend>
              {opcao(
                "KEEP_PRICES",
                acordo
                  ? `Copia exatamente o preço unitário de cada linha da condição aceita na ${versao}.`
                  : `Copia exatamente o preço unitário de cada linha da ${versao} — preço oferecido, não acordo.`,
              )}
              {opcao(
                "REVIEW_PRICES",
                "As linhas nascem sem preço unitário, aguardando uma nova decisão de preço.",
              )}
            </fieldset>
          </>
        )
      }
      onCancel={onCancel}
      onConfirm={() => {
        if (estrategia) onConfirm(estrategia);
      }}
    />
  );
}
