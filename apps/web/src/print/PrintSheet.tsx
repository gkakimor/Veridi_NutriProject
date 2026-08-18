import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useOptionalAuth } from "../app/AuthProvider";
import { BrandLogo } from "../components/BrandLogo";
import { PrintActions } from "./PrintLayout";
import "./print.css";

/**
 * Folha operacional impressa (FO-xx).
 *
 * Documento de papel: o operador imprime, leva para o chão de fábrica,
 * anota à mão e volta a registrar no ERP. Por isso pode conter campos que
 * NÃO existem no banco (contagem, conferido, assinatura) — eles são espaço
 * de anotação manual, nunca dado persistido, e o papel jamais aprova nada.
 *
 * `FO-xx` é só identificação documental: não existe entidade
 * `OperationalSheet`. A rota vive FORA do AppShell — nada de sidebar,
 * topbar, filtros ou botões no papel — e a impressão é sempre explícita:
 * a tela abre em pré-visualização e o usuário decide imprimir.
 */
export function PrintSheet({
  sheetCode,
  title,
  subtitle,
  meta,
  filters,
  backTo,
  landscape,
  children,
}: {
  /** Identificação documental: FO-01, FO-02… */
  sheetCode: string;
  title: string;
  subtitle?: string;
  /** Contexto do documento (OP, pedido, cliente…). */
  meta?: { label: string; value: ReactNode }[];
  /** Filtros aplicados na origem — o papel precisa dizer o que ele mostra. */
  filters?: { label: string; value: ReactNode }[];
  backTo: string;
  /** Só quando a largura realmente exige — o padrão é retrato. */
  landscape?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;

  return (
    <div className={landscape ? "print-screen print-screen--landscape" : "print-screen"}>
      <article className="print-doc">
        <header className="print-doc__header">
          <div>
            {/* Marca oficial local — o papel nunca busca nada na rede. */}
            <BrandLogo className="print-doc__logo" />
            <div className="print-doc__kind">{title}</div>
            {subtitle && <div className="print-doc__status">{subtitle}</div>}
          </div>
          <div className="print-doc__header-right">
            <div className="print-doc__doc-code">{sheetCode}</div>
            <div className="print-doc__status">
              Gerado em {new Date().toLocaleString("pt-BR")}
            </div>
            {/* Quem gerou a IMPRESSÃO — não substitui os snapshots de quem
                executou/aprovou cada ato no sistema. */}
            <div className="print-doc__status">Gerado por {user?.name ?? "—"}</div>
          </div>
        </header>

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

        {filters && filters.length > 0 && (
          <dl className="print-doc__meta print-doc__filters">
            {filters.map((entry) => (
              <div key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {children}

        <footer className="print-doc__foot">
          Veridi Nutrition · documento gerado pelo sistema em{" "}
          {new Date().toLocaleString("pt-BR")} · {sheetCode}
        </footer>

        {/*
          Mesmo rodapé corrido do `PrintLayout`.

          Relatório e folha operacional saem com dezenas de folhas: sem isto
          a identidade documental existia só na página 1 e a folha que se
          separa da pilha não dizia de que documento veio. O número da página
          continua vindo do navegador — o que o papel garante é que toda
          folha se identifica.
        */}
        <div className="print-running-foot" aria-hidden="true">
          <span>{title}</span>
          <span>{sheetCode}</span>
        </div>
      </article>

      <PrintActions onBack={() => navigate(backTo)} />
    </div>
  );
}

/**
 * Área de anotação manual do papel.
 *
 * É assinatura em papel — deliberadamente NÃO é assinatura eletrônica nem
 * aprovação GMP digital; o registro válido continua sendo o do sistema.
 */
export function PrintSignatureArea({
  fields = ["Responsável / assinatura", "Data"],
}: {
  fields?: string[];
}) {
  return (
    <div className="print-signature">
      {fields.map((field) => (
        <div key={field} className="print-signature__field">
          <span className="print-signature__line" aria-hidden="true" />
          <span className="print-signature__label">{field}</span>
        </div>
      ))}
    </div>
  );
}

/** Célula em branco para anotação manual (contagem, conferência, observação). */
export function PrintWriteCell({ width = "80px" }: { width?: string }) {
  return <td className="print-write" style={{ minWidth: width }} />;
}

/** Caixa de conferência em papel — nunca persiste nada. */
export function PrintCheckCell() {
  return <td className="print-write print-write--check">☐</td>;
}
