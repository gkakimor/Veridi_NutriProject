import type { ReactNode } from "react";

/**
 * A linha de vazio de uma tabela — a única que escreve `td.table__empty`.
 *
 * A célula tem `colspan` e, por isso, a largura da tabela inteira; célula de
 * tabela ignora `max-width`. A frase e a ação ficam num corpo com a largura
 * VISÍVEL do contêiner (`.table__empty-body`), preso à esquerda da rolagem.
 *
 * Escrita à mão, a linha perdia esse corpo (LISTS-EMPTY-ROW-390-RAW-01): em
 * 390px o link de `SupplierItemsSection` ia de x=351 a 618 com a borda em 349,
 * e a frase longa do recurso sem tarifa terminava em 625. Tabela com linhas
 * não muda nada — a rolagem horizontal delas continua valendo.
 */
export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table__empty">
        <div className="table__empty-body">{children}</div>
      </td>
    </tr>
  );
}
