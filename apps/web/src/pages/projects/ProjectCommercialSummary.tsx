import { PROJECT_STATUS_LABELS, QUOTE_STATUS_LABELS } from "@veridi/shared";
import type { ProjectDTO, QuoteVersionDTO } from "@veridi/shared";
import { formatBRL } from "../../lib/currency";
import { formatDate, formatEventDate } from "../../lib/dates";
import { condicaoDePagamentoPorExtenso } from "../../lib/payment-condition";

/**
 * O lado comercial da ficha do Projeto — PROJECT-COMMERCIAL-SUMMARY-01.
 *
 * Quem abre um Projeto para conversar com o cliente precisa saber, sem
 * rolar a página até as versões: em que pé está a negociação, quanto vale a
 * proposta, o que ela cobre e quando foi comunicada.
 *
 * É READ MODEL PURO. Tudo sai de `project.quoteVersions`, que já vem inteiro
 * no mesmo GET do detalhe: nenhuma chamada nova, nenhum campo novo em
 * `Project`, nenhum total recalculado. Valor é `QuoteVersionDTO.total`, que o
 * servidor já entrega com o desconto aplicado — somar linhas aqui produziria
 * um segundo número sobre o mesmo fato, e proposta enviada é condição
 * congelada.
 */

/**
 * As DUAS versões que a ficha precisa distinguir.
 *
 * A mais recente pode ser um rascunho enquanto a última proposta que o
 * cliente realmente recebeu é anterior — `V3 SENT` + `V4 DRAFT` é o caso
 * normal de uma renegociação em aberto. Misturar as duas é a leitura falsa
 * que este bloco existe para não produzir: mostrar "V4 · Rascunho" ao lado
 * de "Enviado em: 14/09" faria parecer que a V4 foi enviada.
 *
 * `sentAt` é o único carimbo que responde "foi comunicada": `createdAt` e
 * `updatedAt` dizem quando a linha foi mexida, o que é outra pergunta.
 */
export function resolverVersoesDoResumo(versions: readonly QuoteVersionDTO[]): {
  latest: QuoteVersionDTO | null;
  lastSent: QuoteVersionDTO | null;
} {
  const porVersao = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  const enviadas = porVersao.filter((quote) => quote.sentAt !== null);
  return {
    latest: porVersao.at(-1) ?? null,
    lastSent: enviadas.at(-1) ?? null,
  };
}

/** "3 produtos" / "1 produto" — `QuoteLine` é única por produto na versão. */
function itensOrcados(quote: QuoteVersionDTO | null): string {
  const total = quote?.lines.length ?? 0;
  return `${total} ${total === 1 ? "produto" : "produtos"}`;
}

/**
 * O último ato comercial do projeto, em uma frase.
 *
 * Sai dos carimbos que as versões já carregam — enviada, aceita, recusada —,
 * e o mais recente vence. Não existe log de atividade aqui, e não deve
 * existir: inventar um registro paralelo de eventos é como um CRM nasce sem
 * ninguém decidir que queria um.
 */
function ultimaAtividadeComercial(versions: readonly QuoteVersionDTO[]): string | null {
  const eventos = versions.flatMap((quote) => {
    const rotulo = `Orçamento V${quote.versionNumber}`;
    return [
      quote.sentAt ? { em: quote.sentAt, texto: `${rotulo} enviado` } : null,
      quote.acceptedAt ? { em: quote.acceptedAt, texto: `${rotulo} aceito` } : null,
      quote.rejectedAt ? { em: quote.rejectedAt, texto: `${rotulo} recusado` } : null,
    ].filter((evento): evento is { em: string; texto: string } => evento !== null);
  });
  if (eventos.length === 0) return null;

  const ultimo = eventos.reduce((melhor, evento) => (evento.em > melhor.em ? evento : melhor));
  return `${ultimo.texto} em ${formatEventDate(ultimo.em)}`;
}

export function ProjectCommercialSummary({ project }: { project: ProjectDTO }) {
  const { latest, lastSent } = resolverVersoesDoResumo(project.quoteVersions);
  /*
   * A linha "Última proposta enviada" só existe quando ela é OUTRA versão.
   * Quando a versão corrente é a própria enviada, repetir a informação em
   * duas linhas faria a ficha parecer descrever dois documentos.
   */
  const mostrarUltimaEnviada = lastSent !== null && lastSent.id !== latest?.id;
  const atividade = ultimaAtividadeComercial(project.quoteVersions);

  return (
    <div className="project-commercial">
      <h4>Comercial</h4>
      <dl className="definition-list">
        <dt>Situação do projeto</dt>
        <dd>{PROJECT_STATUS_LABELS[project.status]}</dd>

        <dt>Último orçamento</dt>
        <dd>
          {latest ? (
            <>
              {latest.versionLabel} · {QUOTE_STATUS_LABELS[latest.status]}
              {/* O veredito de vencida é do servidor (`expired`), que compara
                  DIA CIVIL. Recalcular no navegador vencia a proposta às 21h
                  do próprio dia impresso nela. */}
              {latest.expired && <span className="badge badge--inactive">Vencida</span>}
            </>
          ) : (
            "Nenhum"
          )}
        </dd>

        <dt>Valor da proposta</dt>
        {/* `total` já é subtotal menos desconto. `null` é "ainda não há total"
            — nunca R$ 0,00, que é um preço. */}
        <dd className="project-commercial__amount">{formatBRL(latest?.total ?? null)}</dd>

        <dt>Itens orçados</dt>
        <dd>{itensOrcados(latest)}</dd>

        <dt>Condição de pagamento</dt>
        <dd>{condicaoDePagamentoPorExtenso(latest?.paymentSchedule)}</dd>

        <dt>Enviado em</dt>
        {/* Da PRÓPRIA versão corrente, e nunca da anterior — rascunho não foi
            enviado. `sentAt` é INSTANTE: `formatEventDate` o lê no fuso da
            operação; `validUntil` abaixo é DATA CIVIL e vai por `formatDate`. */}
        <dd>{formatEventDate(latest?.sentAt)}</dd>

        <dt>Validade</dt>
        <dd>{formatDate(latest?.validUntil ?? null)}</dd>

        {mostrarUltimaEnviada && (
          <>
            <dt>Última proposta enviada</dt>
            <dd>
              {lastSent.versionLabel} · {formatEventDate(lastSent.sentAt)}
            </dd>
          </>
        )}

        <dt>Última atividade comercial</dt>
        <dd>{atividade ?? "Nenhum orçamento enviado"}</dd>
      </dl>
    </div>
  );
}
