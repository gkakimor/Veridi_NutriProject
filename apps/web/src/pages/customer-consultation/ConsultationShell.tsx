import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import type { CustomerConsultationSummaryDTO } from "@veridi/shared";
import { CUSTOMER_STATUS_LABELS, formatBrPhone, formatCnpj } from "@veridi/shared";
import { customerStatusBadgeClass } from "../customers/customer-status-badge";
import { getConsultationSummary } from "../../lib/customer-consultation-api";
import { NotFoundApiError } from "../../lib/api-errors";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

/**
 * CONSULTA DO CLIENTE — o shell.
 *
 * Regra central da capacidade: aqui dentro o Cliente é a RAIZ da navegação.
 * Abrir um Projeto, um Pedido ou um Faturamento não troca de assunto — troca
 * de aba sob o mesmo cabeçalho. Sair para o módulo operacional continua
 * possível, mas só por uma ação explícita ("Abrir … completo"), nunca por um
 * clique comum.
 *
 * O contexto vive na URL, não em estado global. `:customerId` é o contexto,
 * então refresh, deep link, aba nova e back/forward do navegador funcionam
 * sem nenhuma sincronização — e nenhum módulo operacional passa a carregar a
 * noção de "cliente atual".
 */

export interface ConsultationContext {
  customerId: string;
  summary: CustomerConsultationSummaryDTO;
  /** Recarrega o resumo — os contadores mudam quando o operador opera em outra aba. */
  reload: () => void;
}

export function useConsultationContext(): ConsultationContext {
  return useOutletContext<ConsultationContext>();
}

/** Raiz da Consulta: a busca. Também é o destino de "Trocar cliente". */
export const CONSULTATION_ROOT = "/consultas/clientes";

export function consultationPath(customerId: string, ...rest: string[]): string {
  return [CONSULTATION_ROOT, encodeURIComponent(customerId), ...rest].join("/");
}

interface TrailStep {
  label: string;
  /** Ausente no último passo: a página atual não é link para si mesma. */
  to?: string;
}

/**
 * Breadcrumb contextual.
 *
 * "Projetos" aqui volta para os Projetos DESTE Cliente, nunca para a lista
 * global — é essa diferença que faz trocar de PROJ-001 para PROJ-002 sem
 * jamais perder "Vida Saudável".
 */
export function ConsultationTrail({ steps }: { steps: TrailStep[] }) {
  const { customerId, summary } = useConsultationContext();
  const customerLabel = summary.customer.tradeName ?? summary.customer.legalName;

  const all: TrailStep[] = [
    { label: customerLabel, to: consultationPath(customerId, "resumo") },
    ...steps,
  ];

  return (
    <nav className="consult-trail" aria-label="Trilha da consulta">
      <ol>
        <li>
          <Link to={CONSULTATION_ROOT}>Visão do Cliente</Link>
        </li>
        {all.map((step, index) => (
          <li key={`${step.label}-${index}`}>
            {step.to && index < all.length - 1 ? (
              <Link to={step.to}>{step.label}</Link>
            ) : (
              <span aria-current="page">{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/*
 * Ordem: o que o Cliente É antes do que aconteceu com ele. Produtos vem
 * logo depois do Resumo porque é a pergunta mais frequente — "o que a gente
 * faz para esse cliente?" —, e Estoque substituiu "Materiais do cliente"
 * porque agora carrega duas coisas: o acabado da Veridi e o material dele.
 */
const TABS: { label: string; segment: string }[] = [
  { label: "Resumo", segment: "resumo" },
  { label: "Produtos", segment: "produtos" },
  { label: "Projetos", segment: "projetos" },
  { label: "Pedidos", segment: "pedidos" },
  { label: "Produção", segment: "producao" },
  { label: "Estoque", segment: "estoque" },
  { label: "Faturamentos", segment: "faturamentos" },
];

/** O resumo, o 404 e a falha pertencem ao cliente que os pediu. */
interface CargaDoCliente {
  customerId: string;
  summary: CustomerConsultationSummaryDTO | null;
  notFound: boolean;
  error: string | null;
}

export function ConsultationShell() {
  const { customerId } = useParams<{ customerId: string }>();
  const [carga, setCarga] = useState<CargaDoCliente | null>(null);
  const clienteDaRota = useRef(customerId);
  clienteDaRota.current = customerId;

  const reload = useCallback(() => {
    if (!customerId) return;
    setCarga((atual) => (atual?.customerId === customerId ? { ...atual, error: null } : atual));
    getConsultationSummary(customerId)
      .then((result) => {
        // Resposta de um cliente que já saiu da rota não vira cabeçalho.
        if (clienteDaRota.current !== customerId) return;
        setCarga({ customerId, summary: result, notFound: false, error: null });
      })
      .catch((err: unknown) => {
        if (clienteDaRota.current !== customerId) return;
        // 404 é um estado da tela, não uma falha: o endereço aponta para um
        // cliente que não existe. Erro de verdade continua sendo erro.
        if (err instanceof NotFoundApiError) {
          setCarga({ customerId, summary: null, notFound: true, error: null });
          return;
        }
        const error = err instanceof Error ? err.message : "Falha ao carregar o cliente";
        setCarga((atual) => ({
          customerId,
          summary: atual?.customerId === customerId ? atual.summary : null,
          notFound: false,
          error,
        }));
      });
  }, [customerId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /*
   * O cliente anterior some NO RENDER em que a rota muda
   * (CONSULTATION-CUSTOMER-SWITCH-QUERY-01). Apagado por efeito, a aba ainda
   * montava com o resumo antigo e consultava o cliente novo; o shell a tirava
   * para carregar e ela consultava de novo ao voltar — duas consultas por troca,
   * a primeira descartada. Derivado aqui, a aba só monta com o resumo do
   * cliente da rota, e consulta uma vez.
   */
  const atual = carga?.customerId === customerId ? carga : null;
  const summary = atual?.summary ?? null;
  const notFound = atual?.notFound ?? false;
  const error = atual?.error ?? null;

  if (!customerId) return null;

  if (notFound) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Cliente não encontrado</h1>
          <p className="page__subtitle">
            Este endereço não corresponde a nenhum cliente cadastrado.
          </p>
          <Link className="btn btn--secondary" to={CONSULTATION_ROOT}>
            ← Voltar para a busca
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Visão do Cliente</h1>
          <p className="form-alert" role="alert">{error}</p>
          <button type="button" className="btn btn--secondary" onClick={reload}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Visão do Cliente</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  const { customer } = summary;

  return (
    <div className="consult">
      <header className="consult-head">
        <div className="consult-head__identity">
          <h1>{customer.legalName}</h1>
          <div className="consult-head__meta">
            <span className="is-code">{customer.code}</span>
            {customer.tradeName && <span>{customer.tradeName}</span>}
            {customer.cnpj && <span>CNPJ {formatCnpj(customer.cnpj)}</span>}
            {/* Situação cadastral (§95) no cabeçalho: bloqueado e inativo
                seguem o operador por todas as abas, com o motivo no rótulo. */}
            {customer.status !== "ACTIVE" && (
              <span
                className={customerStatusBadgeClass(customer.status)}
                {...(customer.block ? { title: `Motivo: ${customer.block.reason}` } : {})}
              >
                {CUSTOMER_STATUS_LABELS[customer.status]}
              </span>
            )}
          </div>
          {(customer.phone ?? customer.email) && (
            <div className="consult-head__contact">
              {customer.phone && <span>{formatBrPhone(customer.phone)}</span>}
              {customer.email && <span>{customer.email}</span>}
            </div>
          )}
        </div>

        <div className="table__actions">
          {/* A regra da capacidade — cliente é a raiz, só se sai por ação
              explícita — estava só no comentário deste arquivo, onde nenhum
              operador leria. */}
          <ContextHelp topic={helpTopics["consultaCliente.comoFunciona"]} />
          <Link className="btn btn--secondary btn--sm" to={CONSULTATION_ROOT}>
            Trocar cliente
          </Link>
        </div>
      </header>

      {/* Navegação de rota de verdade: cada aba é um endereço, então o
          histórico do navegador, abrir em nova aba e o foco do teclado
          funcionam sem nenhum tratamento especial. */}
      <nav className="consult-tabs" aria-label="Seções da consulta">
        {TABS.map((tab) => (
          <NavLink
            key={tab.segment}
            to={consultationPath(customerId, tab.segment)}
            className={({ isActive }) =>
              isActive ? "consult-tabs__link is-active" : "consult-tabs__link"
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="consult-body">
        <Outlet context={{ customerId, summary, reload } satisfies ConsultationContext} />
      </div>
    </div>
  );
}
