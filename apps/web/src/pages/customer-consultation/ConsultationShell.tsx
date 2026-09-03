import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import type { CustomerConsultationSummaryDTO } from "@veridi/shared";
import { formatBrPhone, formatCnpj } from "@veridi/shared";
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
          <Link to={CONSULTATION_ROOT}>Consulta de Cliente</Link>
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

export function ConsultationShell() {
  const { customerId } = useParams<{ customerId: string }>();
  const [summary, setSummary] = useState<CustomerConsultationSummaryDTO | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!customerId) return;
    setError(null);
    getConsultationSummary(customerId)
      .then((result) => {
        setSummary(result);
        setNotFound(false);
      })
      .catch((err: unknown) => {
        // 404 é um estado da tela, não uma falha: o endereço aponta para um
        // cliente que não existe. Erro de verdade continua sendo erro.
        if (err instanceof NotFoundApiError) {
          setNotFound(true);
          setSummary(null);
          return;
        }
        setError(err instanceof Error ? err.message : "Falha ao carregar o cliente");
      });
  }, [customerId]);

  useEffect(() => {
    // Some o cliente anterior ANTES de buscar o novo: sem isso, trocar de
    // cliente mostraria o cabeçalho antigo sobre os dados que estão chegando.
    setSummary(null);
    setNotFound(false);
    reload();
  }, [reload]);

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
          <h1 className="page__title">Consulta de Cliente</h1>
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
          <h1 className="page__title">Consulta de Cliente</h1>
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
            {!customer.active && <span className="badge badge--inactive">Inativo</span>}
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
