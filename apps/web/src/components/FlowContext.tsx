import { Link } from "react-router-dom";

export interface FlowStep {
  /** Rótulo do tipo de documento: "Projeto", "Pedido", "OP"… */
  kind: string;
  /** Código de negócio (PROJ-…, PED-…, LT-…). */
  code: string;
  /** Destino da navegação; sem rota, o passo aparece como texto. */
  path?: string;
  /** Texto curto de apoio (cliente, produto, status). */
  detail?: string | null;
  /** Passo correspondente ao documento aberto agora. */
  current?: boolean;
}

/**
 * Cadeia de documentos de negócio — de onde este documento veio e para
 * onde ele foi.
 *
 * É NAVEGAÇÃO, não status: nada aqui recalcula estado, e etapa inexistente
 * não é exibida como se fosse documento pendente (um pedido sem
 * faturamento simplesmente não mostra faturamento). Também não substitui a
 * rastreabilidade: a genealogia completa continua na tela dedicada do lote.
 *
 * Diferente do breadcrumb, que descreve a navegação da interface
 * (Comercial › Pedidos › PED-000123): aqui o que se descreve é o fluxo
 * operacional (Pedido › OP › Expedição › Faturamento).
 */
export function FlowContext({ steps, label = "Fluxo do documento" }: { steps: FlowStep[]; label?: string }) {
  const visible = steps.filter((step) => step.code);
  if (visible.length === 0) return null;

  return (
    <nav className="flow-context" aria-label={label}>
      {visible.map((step, index) => (
        <span key={`${step.kind}-${step.code}`} className="flow-context__step">
          {index > 0 && (
            <span className="flow-context__arrow" aria-hidden="true">
              ›
            </span>
          )}
          <span className={step.current ? "flow-context__node is-current" : "flow-context__node"}>
            <span className="flow-context__kind">{step.kind}</span>
            {step.path && !step.current ? (
              <Link to={step.path} className="flow-context__code">
                {step.code}
              </Link>
            ) : (
              <span className="flow-context__code">{step.code}</span>
            )}
            {step.detail && <span className="flow-context__detail">{step.detail}</span>}
          </span>
        </span>
      ))}
    </nav>
  );
}
