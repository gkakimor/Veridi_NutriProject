import type { ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";
import type { ControlledDocumentRevisionDTO } from "@veridi/shared";
import "./print.css";
import { formatDate } from "../lib/dates";

/**
 * Esqueleto de impressão (documentos e relatórios).
 *
 * FAST MVP não gera PDF no backend: a página é HTML + CSS `@media print` e o
 * navegador imprime ou salva como PDF. O layout mostra apenas conteúdo
 * read-only — topbar, sidebar, botões, inputs e paginação somem no papel.
 */
export function PrintLayout({
  kind,
  code,
  status,
  isDraft,
  notice,
  meta,
  children,
  generatedFor,
  documentCode,
  revision,
}: {
  /** Tipo do documento/relatório: "ORDEM DE COMPRA", "R-01 · Posição de Estoque"… */
  kind: string;
  code: string;
  status?: string;
  isDraft?: boolean;
  /** Aviso obrigatório em alguns documentos (ex.: faturamento não é NF). */
  notice?: string;
  meta?: { label: string; value: ReactNode }[];
  children: ReactNode;
  /** Complemento do rodapé (ex.: total de registros do relatório). */
  generatedFor?: string;
  /** Código do documento controlado (R.PRO.002, R.COQ.003). */
  documentCode?: string;
  /**
   * Revisão vigente congelada no documento. Isto é suporte documental e de
   * auditoria — o sistema não declara certificação GMP nem conformidade
   * ANVISA em lugar nenhum.
   */
  revision?: ControlledDocumentRevisionDTO | null;
}) {
  return (
    <article className="print-doc">
      <header className="print-doc__header">
        <div>
          <BrandLogo className="print-doc__logo" />
          <div className="print-doc__kind">{kind}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {documentCode && <div className="print-doc__doc-code">{documentCode}</div>}
          <div className="print-doc__code">{code}</div>
          {status && <div className="print-doc__status">{status}</div>}
          {isDraft && <div className="print-doc__draft">Rascunho</div>}
        </div>
      </header>

      {documentCode && (
        <dl className="print-doc__meta print-doc__control">
          <div>
            <dt>Código do documento</dt>
            <dd>{documentCode}</dd>
          </div>
          <div>
            <dt>Revisão</dt>
            <dd>{revision ? revision.revision : "—"}</dd>
          </div>
          <div>
            <dt>Data da revisão</dt>
            <dd>
              {revision?.revisionDate
                ? formatDate(revision.revisionDate)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Elaboração</dt>
            <dd>{revision?.preparedByName ?? "—"}</dd>
          </div>
          <div>
            <dt>Aprovação</dt>
            <dd>{revision?.approvedByName ?? "—"}</dd>
          </div>
        </dl>
      )}

      {notice && <p className="print-doc__notice">{notice}</p>}

      {meta && meta.length > 0 && (
        <dl className="print-doc__meta">
          {meta.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      <footer className="print-doc__foot">
        Gerado pelo sistema em {new Date().toLocaleString("pt-BR")}
        {generatedFor ? ` · ${generatedFor}` : ""}
        {/* Carimbo de geração — NÃO é assinatura digital. */}
      </footer>

      {/*
        Rodapé corrido, repetido em toda página impressa.

        Um relatório de quinze folhas saía com identidade só na primeira e no
        fim: a folha que cai da mesa não dizia de onde veio nem a que
        documento pertence. O número da página em si vem do navegador (o
        Chrome não implementa as caixas de margem de `@page`, então o sistema
        não tem como escrevê-lo dentro da folha) — o que o documento garante
        é que toda página se identifica.
      */}
      <div className="print-running-foot" aria-hidden="true">
        <span>
          {kind} · {code}
        </span>
        <span>{documentCode ?? ""}</span>
      </div>
    </article>
  );
}

export function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-doc__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Cabeçalho de coluna numérica.
 *
 * As células já se marcam com `is-number` uma a uma; o cabeçalho não tinha
 * como saber disso e ficava à esquerda enquanto os números iam para a
 * direita. Como o rótulo é a única informação que a tabela dá sobre a coluna,
 * é ele que decide — e a lista abaixo é a mesma nomenclatura que os
 * documentos já usam.
 */
export const COLUNA_NUMERICA =
  /^(qtd\.?|quantidade|quant\.|pedido|reservado\/expedido|reservado|expedido|faturado|falta.*|pre[çc]o.*|total.*|subtotal.*|saldo.*|custo.*|valor.*|f[íi]sico|dispon[íi]vel|em compra|recebido.*|produzido.*|planejado.*|consumido.*|percentual|%|margem.*|comiss[ãa]o.*|peso.*|volume.*|unit[áa]rio.*|itens|lotes.*|meses.*|dias.*|m[íi]nimo.*|necess[áa]rio.*)$/i;

export function PrintTable({
  columns,
  children,
  emptyMessage,
  isEmpty,
}: {
  columns: string[];
  children: ReactNode;
  emptyMessage: string;
  isEmpty: boolean;
}) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} {...(COLUNA_NUMERICA.test(column.trim()) ? { className: "is-number" } : {})}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {children}
        {isEmpty && (
          <tr>
            <td colSpan={columns.length}>{emptyMessage}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Barra de ações da página de impressão — nunca aparece no papel. */
export function PrintActions({ onBack }: { onBack: () => void }) {
  return (
    <div className="print-actions">
      <button type="button" className="btn btn--ghost" onClick={onBack}>
        ← Voltar
      </button>
      <button type="button" className="btn btn--primary" onClick={() => window.print()}>
        Imprimir / Salvar PDF
      </button>
    </div>
  );
}

export function formatPrintDate(value: string | null | undefined): string {
  if (!value) return "—";
  return formatDate(value);
}

export function formatPrintDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

/** Valor ausente aparece como "—"; custo/preço desconhecido nunca vira zero. */
export function printOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : value;
}
