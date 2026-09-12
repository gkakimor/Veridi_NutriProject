import { ConfirmDialog } from "./ConfirmDialog";
import type { FonteDeAlteracao } from "../app/unsaved-changes-context";

/**
 * A pergunta de saída — uma só no sistema inteiro.
 *
 * É o `ConfirmDialog` do Veridi com o texto da guarda: papel `alertdialog`,
 * foco inicial no primeiro controle (que aqui é "Continuar editando", a saída
 * segura) e Escape equivalendo a ele. Empilhar duas perguntas dessas sobre a
 * mesma decisão seria pior do que não perguntar, então quem a monta é o
 * provider, e ele só monta uma.
 */
export function UnsavedChangesDialog({
  open,
  fonte,
  onContinuarEditando,
  onSairSemSalvar,
}: {
  open: boolean;
  /** De onde veio a pendência — dá o substantivo do texto. */
  fonte: FonteDeAlteracao | null;
  onContinuarEditando: () => void;
  onSairSemSalvar: () => void;
}) {
  const substantivo = fonte?.substantivo ?? "registro";
  const demonstrativo = fonte?.genero === "a" ? "nesta" : "neste";

  return (
    <ConfirmDialog
      open={open}
      title="Sair sem salvar?"
      message={
        <p>
          Você tem alterações não salvas {demonstrativo} {substantivo}. Se sair agora, elas serão
          perdidas.
        </p>
      }
      cancelLabel="Continuar editando"
      confirmLabel="Sair sem salvar"
      onCancel={onContinuarEditando}
      onConfirm={onSairSemSalvar}
    />
  );
}
