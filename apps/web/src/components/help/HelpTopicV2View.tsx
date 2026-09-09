import { Link } from "react-router-dom";
import { helpConcepts } from "../../help/concepts";
import { helpHints } from "../../help/help-content";
import type { HelpConcept, HelpStep, HelpTopicV2 } from "../../help/help-content";
import { FlowSteps } from "./FlowSteps";

/**
 * O corpo do painel para um tópico no modelo V2 — os três níveis, na ordem.
 *
 * A ordem é a mudança. O modelo antigo abria pelo glossário, e a auditoria
 * mediu o custo disso: quem abre a ajuda quer saber o que faz nesta tela, e
 * chegava a um dicionário. Aqui o nível 1 — o que é, quando usar, o que vem
 * depois — está no topo e não recolhe. O passo a passo e as automações vêm
 * abertos logo abaixo. Termos, situações, ressalvas, exemplo e "Saiba mais"
 * ficam em `<details>` fechado: são consulta, não leitura.
 *
 * É a "opção A" da auditoria: conteúdo e ordem novos dentro do modal que já
 * existe. O painel lateral com abas é a rodada seguinte, e o conteúdo escrito
 * aqui migra para ele sem reescrita.
 */
export function HelpTopicV2View({
  topic,
  onNavegar,
}: {
  topic: HelpTopicV2;
  /**
   * Chamado quando a pessoa clica num destino interno. O painel precisa sair
   * da frente: navegar por baixo de um modal aberto deixa a tela nova
   * inacessível e faz parecer que o link não funcionou.
   */
  onNavegar: () => void;
}) {
  /*
   * "Onde isto entra" reusa o mesmo desenho dos fluxos do modelo antigo: a
   * tela atual em destaque, o que vem antes e o que vem depois em volta. O
   * `tone` "accent" é o que a folha de estilo já pinta como caixa da vez.
   */
  const processo: HelpStep[] = topic.process
    ? [
        ...topic.process.before.map((label) => ({ label })),
        { label: topic.process.here, tone: "accent" as const },
        ...topic.process.after.map((label) => ({ label })),
      ]
    : [];

  const termos = (topic.terms ?? []).map(resolverTermo);

  return (
    <>
      {/* ---------- Nível 1 — sempre visível ---------- */}
      <p className="help-modal__summary">{topic.oneLiner}</p>

      <h3 className="help-modal__subtitle">Quando usar</h3>
      <ul className="help-modal__notes">
        {topic.whenToUse.map((caso) => (
          <li key={caso}>{caso}</li>
        ))}
      </ul>

      <h3 className="help-modal__subtitle">Próximo passo</h3>
      <ul className="help-modal__notes">
        {topic.nextSteps.map((passo) => (
          <li key={passo.label}>
            <HelpDestino {...passo} onNavegar={onNavegar} />
          </li>
        ))}
      </ul>

      {/* ---------- Nível 2 — aberto ---------- */}
      {topic.prerequisites && topic.prerequisites.length > 0 && (
        <>
          <h3 className="help-modal__subtitle">Antes de começar</h3>
          <ul className="help-modal__notes">
            {topic.prerequisites.map((pre) => (
              <li key={pre.text}>
                <HelpDestino
                  label={pre.text}
                  onNavegar={onNavegar}
                  {...(pre.href ? { href: pre.href } : {})}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="help-modal__subtitle">Passo a passo</h3>
      {/*
        Uma coluna, não duas: cada passo é um par "você faz / o sistema faz",
        e quebrar o par entre colunas separa a ação da consequência — que é
        exatamente a ligação que o formato existe para mostrar.
      */}
      <ol className="help-modal__steps help-modal__steps--pairs">
        {topic.steps.map((step, index) => (
          <li key={`${index}-${step.you}`}>
            <b>{step.you}</b>
            {step.system && <span className="help-modal__step-detail">{step.system}</span>}
          </li>
        ))}
      </ol>

      {topic.automations && topic.automations.length > 0 && (
        <>
          <h3 className="help-modal__subtitle">O sistema faz sozinho</h3>
          <ul className="help-modal__notes">
            {topic.automations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {processo.length > 0 && (
        <section className="help-modal__flow">
          <h3 className="help-modal__subtitle">Onde isto entra</h3>
          <FlowSteps steps={processo} label="Onde esta tela entra no processo" />
        </section>
      )}

      {/* ---------- Nível 3 — recolhido ---------- */}
      {termos.length > 0 && (
        <HelpDetalhe titulo="Termos desta tela" contagem={termos.length}>
          <dl className="help-modal__concepts">
            {termos.map((termo) => (
              <div key={termo.term}>
                <dt>{termo.term}</dt>
                <dd>{termo.text}</dd>
              </div>
            ))}
          </dl>
        </HelpDetalhe>
      )}

      {topic.states && topic.states.length > 0 && (
        <HelpDetalhe titulo="Situações" contagem={topic.states.length}>
          <dl className="help-modal__concepts">
            {topic.states.map((situacao) => (
              <div key={situacao.name}>
                <dt>{situacao.name}</dt>
                <dd>{situacao.allows}</dd>
              </div>
            ))}
          </dl>
        </HelpDetalhe>
      )}

      {topic.cautions && topic.cautions.length > 0 && (
        <HelpDetalhe titulo="Atenção" contagem={topic.cautions.length}>
          <ul className="help-modal__notes">
            {topic.cautions.map((aviso) => (
              <li key={aviso}>{aviso}</li>
            ))}
          </ul>
        </HelpDetalhe>
      )}

      {topic.example && (
        <HelpDetalhe titulo="Exemplo">
          <p className="help-modal__example">{topic.example}</p>
        </HelpDetalhe>
      )}

      {topic.learnMore && topic.learnMore.length > 0 && (
        <HelpDetalhe titulo="Saiba mais" contagem={topic.learnMore.length}>
          {/*
            O conceito compartilhado é EXIBIDO aqui, não linkado: a rota
            `/ajuda/conceitos/:slug` é da rodada do painel lateral, e um link
            para uma rota que ainda não existe custa mais confiança do que a
            ausência dele. O texto vem do arquivo do conceito, uma vez só.
          */}
          <dl className="help-modal__concepts">
            {topic.learnMore.map((item) => {
              if (item.concept) {
                const conceito = helpConcepts[item.concept];
                return (
                  <div key={item.concept}>
                    <dt>{conceito.title}</dt>
                    <dd>
                      {conceito.text}
                      {conceito.example && (
                        <span className="help-modal__step-detail">{conceito.example}</span>
                      )}
                    </dd>
                  </div>
                );
              }
              return (
                <div key={item.label ?? item.href}>
                  <dt>
                    <HelpDestino
                      label={item.label ?? ""}
                      onNavegar={onNavegar}
                      {...(item.href ? { href: item.href } : {})}
                    />
                  </dt>
                </div>
              );
            })}
          </dl>
        </HelpDetalhe>
      )}
    </>
  );
}

/**
 * Uma seção de nível 3 — fechada por padrão, com a contagem no título.
 *
 * A contagem existe para a pessoa decidir se vale abrir: "Termos desta tela
 * (9)" informa o tamanho antes do clique, e é o `<details>` nativo que faz o
 * resto — teclado, leitor de tela e busca do navegador incluídos.
 */
function HelpDetalhe({
  titulo,
  contagem,
  children,
}: {
  titulo: string;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="help-modal__details">
      <summary>
        {titulo}
        {contagem !== undefined && ` (${contagem})`}
      </summary>
      {children}
    </details>
  );
}

/**
 * Um destino do painel: vira link quando há rota, texto quando não há.
 *
 * Rota interna usa o `Link` do roteador — sair e voltar recarregando a
 * aplicação inteira custaria o formulário em andamento na tela de trás.
 */
function HelpDestino({
  label,
  href,
  onNavegar,
}: {
  label: string;
  href?: string;
  onNavegar: () => void;
}) {
  if (!href) return <>{label}</>;
  if (/^https?:/i.test(href)) {
    // Endereço externo abre fora: sair do ERP no meio de um pedido custa o
    // formulário em andamento, e o painel continua onde estava.
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }
  return (
    <Link to={href} onClick={onNavegar}>
      {label}
    </Link>
  );
}

/**
 * Um termo pode ser escrito no tópico ou ser a chave de uma dica ⓘ já
 * existente. Reaproveitar a dica é o que impede a mesma coluna de ter duas
 * explicações — a do ícone em cima do campo e a do painel — divergindo com o
 * tempo.
 */
function resolverTermo(termo: HelpTopicV2["terms"] extends (infer T)[] | undefined ? T : never): HelpConcept {
  if (typeof termo !== "string") return termo;
  const dica = helpHints[termo];
  return { term: dica.label, text: dica.text };
}
