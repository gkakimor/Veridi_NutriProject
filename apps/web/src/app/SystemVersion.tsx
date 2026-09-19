import { useEffect, useId, useRef, useState } from "react";
import { VERIDI_VERSION, VERIDI_VERSION_DATE } from "@veridi/shared";
import type { SystemMetaDTO } from "@veridi/shared";
import { ModalDialog } from "../components/ModalDialog";
import { formatDate } from "../lib/dates";
import { fetchSystemMeta } from "../lib/system-api";

/** Como a versão aparece para quem usa — `vMAJOR.MINOR.PATCH` —, da fonte única do shared. */
export const VERSAO_EXIBIDA = `v${VERIDI_VERSION}`;

const ROTULO_DO_AMBIENTE: Record<string, string> = {
  production: "Produção",
  development: "Desenvolvimento",
  test: "Teste",
};

/** Ambiente sem tradução aparece com o nome que a API deu — nunca adivinhado. */
export function rotuloDoAmbiente(ambiente: string): string {
  return ROTULO_DO_AMBIENTE[ambiente] ?? ambiente;
}

/** Build = commit abreviado, os mesmos 8 caracteres do registro do deploy. */
export function commitAbreviado(commitHash: string | null): string | null {
  return commitHash ? commitHash.slice(0, 8) : null;
}

type Consulta = { estado: "consultando" } | { estado: "ok"; meta: SystemMetaDTO } | { estado: "erro" };

/**
 * Versão no cabeçalho e "Sobre o sistema" (VERIDI-SYSTEM-VERSIONING-01).
 *
 * O cabeçalho mostra só a versão, ao lado de "Nutrition": o número vem do
 * bundle, então aparece sem esperar a API. Ambiente e build são fatos do
 * servidor no ar e só existem lá — a tela pergunta a `GET /meta` quando o
 * diálogo abre, e não afirma "Produção" por conta própria.
 */
export function SystemVersion() {
  const titleId = useId();
  const gatilho = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [consulta, setConsulta] = useState<Consulta>({ estado: "consultando" });

  useEffect(() => {
    if (!aberto) return;
    let vigente = true;
    setConsulta({ estado: "consultando" });
    fetchSystemMeta()
      .then((meta) => {
        if (vigente) setConsulta({ estado: "ok", meta });
      })
      .catch(() => {
        if (vigente) setConsulta({ estado: "erro" });
      });
    return () => {
      vigente = false;
    };
  }, [aberto, tentativa]);

  function fechar() {
    setAberto(false);
    // Quem leu volta para onde estava.
    gatilho.current?.focus();
  }

  const ambiente =
    consulta.estado === "ok"
      ? rotuloDoAmbiente(consulta.meta.environment)
      : consulta.estado === "consultando"
        ? "Consultando…"
        : "—";
  const commit = consulta.estado === "ok" ? commitAbreviado(consulta.meta.commitHash) : null;
  const build =
    commit ?? (consulta.estado === "ok" ? "Não informado" : consulta.estado === "consultando" ? "Consultando…" : "—");

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        className="masthead__version"
        title="Sobre o sistema"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => setAberto(true)}
      >
        {VERSAO_EXIBIDA}
      </button>

      {aberto && (
        <ModalDialog labelledBy={titleId} onClose={fechar} role="dialog" dismissOnBackdrop>
          <div className="system-about">
            <h2 id={titleId}>Sobre o sistema</h2>
            <p className="system-about__product">Veridi Nutrition</p>
            <dl className="definition-list">
              <dt>Versão</dt>
              <dd>{VERSAO_EXIBIDA}</dd>
              <dt>Data da versão</dt>
              <dd>{formatDate(VERIDI_VERSION_DATE)}</dd>
              <dt>Ambiente</dt>
              <dd>{ambiente}</dd>
              <dt>Build</dt>
              <dd className={commit ? "system-about__commit" : undefined}>{build}</dd>
            </dl>
            {consulta.estado === "erro" && (
              <p className="system-about__error" role="alert">
                Não foi possível consultar ambiente e build agora.
              </p>
            )}
            <div className="confirm-dialog__actions">
              {consulta.estado === "erro" && (
                <button type="button" className="btn btn--ghost" onClick={() => setTentativa((n) => n + 1)}>
                  Tentar novamente
                </button>
              )}
              <button type="button" className="btn btn--secondary" onClick={fechar}>
                Fechar
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
