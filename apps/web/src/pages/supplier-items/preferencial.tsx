import type { SupplierItemDTO } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/**
 * O fornecedor preferencial do item, do lado da tela — ITEM-SUPPLIER-UX-01.
 *
 * A troca é da API: `POST /supplier-items/:id/preferred` desmarca o anterior e
 * marca o novo na mesma transação, sob trava do Item, e o índice parcial único do
 * banco não deixa existir dois. A tela não encadeia "desmarcar Y, marcar X" —
 * uma queda no meio deixaria o item sem preferencial. Ela só diz, antes, o que a
 * troca vai fazer.
 */

/** O preferencial que o item tem hoje, pelo nome que a pessoa reconhece. */
export interface PreferencialDoItem {
  id: string;
  supplierName: string;
}

/**
 * A mesma condição da API: relação ativa e homologada (o CHECK do banco) e as
 * duas partes ativas — item e fornecedor inativos não começam compromisso novo
 * (SUPPLIER-ITEM-INACTIVE-GATE-01, `PRODUCT_RULES.md` §112).
 *
 * Só governa MARCAR. Remover o preferencial segue oferecido com qualquer parte
 * inativa: é justamente o que resolve o item apontando para quem ninguém pode
 * escolher.
 */
export function podeSerPreferencial(
  relacao: Pick<
    SupplierItemDTO,
    "active" | "qualificationStatus" | "itemActive" | "supplierActive"
  >,
): boolean {
  return (
    relacao.active &&
    relacao.qualificationStatus === "APPROVED" &&
    relacao.itemActive &&
    relacao.supplierActive
  );
}

export function preferencialEntre(relacoes: readonly SupplierItemDTO[]): PreferencialDoItem | null {
  const atual = relacoes.find((relacao) => relacao.preferred);
  return atual ? { id: atual.id, supplierName: atual.supplierName } : null;
}

/**
 * O preferencial do item depois de uma resposta sobre UMA relação dele.
 *
 * A única ação sobre esta relação que muda outra é torná-la preferencial — a API
 * desmarca a anterior. Deixar de ser (remover, bloquear, inativar) só zera o
 * preferencial quando era ela.
 */
export function preferencialDepoisDe(
  atual: PreferencialDoItem | null,
  relacao: Pick<SupplierItemDTO, "id" | "preferred" | "supplierName">,
): PreferencialDoItem | null {
  if (relacao.preferred) return { id: relacao.id, supplierName: relacao.supplierName };
  return atual?.id === relacao.id ? null : atual;
}

/**
 * "Definir X como fornecedor preferencial deste item?"
 *
 * Com outro preferencial, a frase diz quem sai; sem nenhum, diz que o item ainda
 * não tem. Quem abre decide se há mudança real — marcar o que já é preferencial
 * não pergunta nada, porque não chega a pedir.
 */
export function ConfirmarPreferencialDialog({
  candidato,
  atual,
  onConfirm,
  onCancel,
}: {
  /** A relação que vai virar preferencial; `null` mantém o diálogo fechado. */
  candidato: PreferencialDoItem | null;
  atual: PreferencialDoItem | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const substituido = candidato && atual && atual.id !== candidato.id ? atual : null;
  return (
    <ConfirmDialog
      open={candidato !== null}
      title={`Definir ${candidato?.supplierName ?? ""} como fornecedor preferencial deste item?`}
      message={
        <p>
          {substituido
            ? `${candidato?.supplierName ?? ""} substituirá ${substituido.supplierName} como fornecedor preferencial.`
            : "Hoje este item não tem fornecedor preferencial."}
        </p>
      }
      confirmLabel="Definir como preferencial"
      confirmTone="accent"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
