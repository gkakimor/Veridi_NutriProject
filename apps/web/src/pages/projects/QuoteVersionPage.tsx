import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ProjectDTO, QuoteVersionDTO } from "@veridi/shared";
import { QUOTE_STATUS_LABELS } from "@veridi/shared";
import { useAuth } from "../../app/AuthProvider";
import { EntityLink, entityHref } from "../../components/EntityLink";
import { FlowContext } from "../../components/FlowContext";
import { FormSection } from "../../components/FormSection";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { NotFoundApiError } from "../../lib/api-errors";
import { rotaDeRetorno } from "../../lib/contextual-create";
import { formatBRL } from "../../lib/currency";
import { formatDateTime } from "../../lib/dates";
import { getProject, getQuoteVersion } from "../../lib/projects-api";
import { rotaDoOrcamento } from "../../lib/rota-do-orcamento";
import { rotuloDaOrigem } from "../../lib/use-contextual-create";
import { QuoteWorkspace } from "./QuoteWorkspace";
import { formatQuoteDate, quoteBadgeClass } from "./quote-display";

/** Leitura que falhou sem ser 404: rede, 500. A versão existe; a resposta é que não veio. */
const AVISO_DE_LEITURA = "Não foi possível carregar o orçamento agora.";

/**
 * A página própria de uma versão de orçamento — QUOTE-WORKSPACE-NAVIGATION-01.
 *
 * `/comercial/orcamentos/:id`, com o id da VERSÃO: endereçável, recarregável e
 * linkável. Antes a versão só existia dentro da ficha do Projeto, aberta abaixo
 * da lista — clicar em "ORC-000444 · V1" trocava um bloco fora da vista, e
 * parecia que nada tinha acontecido.
 *
 * A carga é a da API de sempre, sem rota nova no servidor: a versão pelo id (é
 * ela que diz se existe) e o Projeto dela, que traz a situação, os produtos e
 * as outras versões. As duas leituras montam a proposta pelo mesmo DTO.
 *
 * A página remonta por versão (`key`): trocar de versão é trocar de documento,
 * e nada da anterior — digitação, confirmação aberta — atravessa.
 */
export function QuoteVersionPage() {
  const { id } = useParams<{ id: string }>();
  return <QuoteVersionDocument key={id} id={id ?? ""} />;
}

/** "3 produtos" / "1 produto" — a versão tem uma linha por produto. */
function produtosDaVersao(quote: QuoteVersionDTO): string {
  const total = quote.lines.length;
  return `${total} ${total === 1 ? "produto" : "produtos"}`;
}

/** Quando e por quem — o carimbo é instante, lido no fuso da operação. */
function carimbo(instante: string, nome: string | null): string {
  return nome ? `${formatDateTime(instante)} · ${nome}` : formatDateTime(instante);
}

function QuoteVersionDocument({ id }: { id: string }) {
  const { user } = useAuth();
  // Os mesmos papéis que negociam no Projeto; a API continua sendo o portão.
  const canEdit = user?.role === "COMMERCIAL" || user?.role === "ADMIN";
  const [params] = useSearchParams();
  /** De onde se chegou — só rota interna; sem ela, a página não inventa volta. */
  const voltar = rotaDeRetorno(params);

  const [dados, setDados] = useState<{ quote: QuoteVersionDTO; project: ProjectDTO } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  /**
   * Falha de leitura que NÃO é 404 — rede, 500. Não diz que a versão não
   * existe: sem página na tela, avisa e oferece tentar de novo; com a página
   * já na tela (releitura depois de uma ação), mantém o que estava e avisa.
   */
  const [loadError, setLoadError] = useState(false);
  /** Só a leitura mais recente escreve: a releitura de uma ação não perde para a anterior. */
  const ultimaLeitura = useRef(0);

  const load = useCallback(() => {
    const leitura = ++ultimaLeitura.current;
    setLoading(true);
    getQuoteVersion(id)
      .then(async (quote) => ({ quote, project: await getProject(quote.projectId) }))
      .then((lido) => {
        if (leitura !== ultimaLeitura.current) return;
        setDados(lido);
        setNotFound(false);
        setLoadError(false);
      })
      .catch((err: unknown) => {
        if (leitura !== ultimaLeitura.current) return;
        if (err instanceof NotFoundApiError) setNotFound(true);
        else setLoadError(true);
      })
      .finally(() => {
        if (leitura === ultimaLeitura.current) setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !dados) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Orçamento</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !dados) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">{notFound ? "Orçamento não encontrado" : "Orçamento"}</h1>
          {notFound ? (
            <p className="page__subtitle">
              Esta versão de orçamento não existe no Veridi — o link que trouxe você até aqui pode
              estar desatualizado.
            </p>
          ) : (
            <p className="form-alert" role="alert">
              {AVISO_DE_LEITURA}{" "}
              <button type="button" className="btn btn--secondary btn--sm" onClick={load}>
                Tentar novamente
              </button>
            </p>
          )}
          <Link className="btn btn--ghost" to={voltar ?? "/comercial/projetos"}>
            {voltar ? `← Voltar para ${rotuloDaOrigem(voltar)}` : "← Voltar para Projetos"}
          </Link>
        </div>
      </div>
    );
  }

  const { quote, project } = dados;
  const fichaDoProjeto = entityHref("project", project.id);
  const versoes = [...project.quoteVersions].sort((a, b) => a.versionNumber - b.versionNumber);
  /*
   * A volta diz para ONDE volta. Vindo da ficha deste Projeto, com o código; de
   * outra tela (o Pedido, e depois a lista de Orçamentos), pelo nome da tela.
   */
  const rotuloDaVolta =
    voltar && voltar.split("?")[0] === fichaDoProjeto
      ? `← Voltar ao Projeto ${project.code}`
      : `← Voltar para ${rotuloDaOrigem(voltar ?? "")}`;

  return (
    <>
      <div className="doc-header">
        <div>
          {/* Onde a versão MORA: no Projeto. A trilha vale venha a pessoa de onde vier. */}
          <PageBreadcrumbs
            items={[
              { label: "Projetos", href: "/comercial/projetos" },
              { label: project.code, href: fichaDoProjeto },
              { label: quote.versionLabel },
            ]}
          />
          <div className="doc-title">
            <h1>{quote.versionLabel}</h1>
            <span className={quoteBadgeClass(quote.status)}>{QUOTE_STATUS_LABELS[quote.status]}</span>
            {quote.expired && <span className="badge badge--warn">Vencido</span>}
          </div>
        </div>
        {/* Volta explícita, nunca o botão Voltar do navegador: só aparece com
            origem na URL, e sobrevive a recarregar a página. */}
        {voltar && (
          <div className="table__actions">
            <Link className="btn btn--ghost btn--sm" to={voltar}>
              {rotuloDaVolta}
            </Link>
          </div>
        )}
      </div>

      <FlowContext
        steps={[
          { kind: "Projeto", code: project.code, detail: project.customerName, path: fichaDoProjeto },
          {
            kind: "Orçamento",
            code: quote.versionLabel,
            detail: QUOTE_STATUS_LABELS[quote.status],
            current: true,
          },
          ...(quote.sourcedOrder
            ? [
                {
                  kind: "Pedido",
                  code: quote.sourcedOrder.code,
                  path: entityHref("customerOrder", quote.sourcedOrder.id),
                },
              ]
            : []),
        ]}
      />

      <div className="doc-body">
        {loadError && (
          <p className="form-alert" role="alert">
            {AVISO_DE_LEITURA} A página abaixo pode estar desatualizada.{" "}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={loading}
              onClick={load}
            >
              Tentar novamente
            </button>
          </p>
        )}

        <ContextHelp topic={helpTopics["comercial.orcamento"]} />

        <FormSection title="Resumo">
          <div className="field-grid-2">
            <dl className="definition-list">
              <dt>Código</dt>
              <dd>
                <span className="code">{quote.code}</span>
              </dd>
              <dt>Versão</dt>
              <dd>V{quote.versionNumber}</dd>
              <dt>Status</dt>
              <dd>{QUOTE_STATUS_LABELS[quote.status]}</dd>
              <dt>Data</dt>
              <dd>{formatQuoteDate(quote.quoteDate)}</dd>
              <dt>Validade</dt>
              <dd>{formatQuoteDate(quote.validUntil)}</dd>
            </dl>
            <dl className="definition-list">
              {/* Enviada em diante, o cliente é o que o documento congelou; o
                  link continua sendo o do cadastro, por identidade. */}
              <dt>Cliente</dt>
              <dd>
                <EntityLink
                  kind="customer"
                  id={project.customerId}
                  code={quote.customerCode ?? project.customerCode}
                  name={quote.customerName ?? project.customerName}
                />
              </dd>
              <dt>Projeto</dt>
              <dd>
                <EntityLink kind="project" id={project.id} code={project.code} name={project.name} />
              </dd>
              <dt>Produtos</dt>
              <dd>{produtosDaVersao(quote)}</dd>
              {/* Rascunho ainda muda: o número é o do último salvamento, e diz isso. */}
              <dt>{quote.status === "DRAFT" ? "Total salvo" : "Total da proposta"}</dt>
              <dd>{formatBRL(quote.total)}</dd>
              {quote.sentAt && (
                <>
                  <dt>Enviado em</dt>
                  <dd>{carimbo(quote.sentAt, quote.sentByName)}</dd>
                </>
              )}
              {quote.acceptedAt && (
                <>
                  <dt>Aceito em</dt>
                  <dd>{carimbo(quote.acceptedAt, quote.acceptedByName)}</dd>
                </>
              )}
              {quote.rejectedAt && (
                <>
                  <dt>Recusado em</dt>
                  <dd>
                    {carimbo(quote.rejectedAt, quote.rejectedByName)}
                    {quote.rejectionReason ? ` — ${quote.rejectionReason}` : ""}
                  </dd>
                </>
              )}
            </dl>
          </div>

          {/* As outras versões são outros endereços — nunca editores empilhados
              na mesma página. */}
          {versoes.length > 1 && (
            <nav className="quote-versions-nav" aria-label="Versões deste projeto">
              <p className="field__label">Versões deste projeto</p>
              <ul>
                {versoes.map((versao) => {
                  const rotulo = `${versao.versionLabel} · ${QUOTE_STATUS_LABELS[versao.status]}`;
                  return (
                    <li key={versao.id}>
                      {versao.id === quote.id ? (
                        <span aria-current="page">{rotulo}</span>
                      ) : (
                        <Link to={rotaDoOrcamento(versao.id, { voltar })}>{rotulo}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </FormSection>

        <FormSection title="Proposta">
          <QuoteWorkspace
            project={project}
            quote={quote}
            canEdit={canEdit}
            projectStatus={project.status}
            onChanged={load}
          />
        </FormSection>
      </div>
    </>
  );
}
