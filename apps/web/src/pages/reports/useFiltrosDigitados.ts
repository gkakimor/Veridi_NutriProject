import { useEffect, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

/** Pausa da digitação que vira consulta — a mesma das buscas das listagens. */
export const PAUSA_DA_DIGITACAO_MS = 300;

/**
 * Campos DIGITADOS de um relatório: busca, De e até (REPORTS-SEARCH-UX-01).
 *
 * Cada tecla ia direto para a consulta: "abc" pedia "a", "ab" e "abc", e,
 * desde que filtro novo esconde o recorte anterior (SMALL-UX-CLEANUP-WAVE-01),
 * a tabela piscava a cada letra. Data digitada é pior: no Chromium, escrever
 * 13/09/2027 sobre 15/08/2026 passa por 01/08, 13/08, vazio, 13/09 e pelos
 * anos 0002, 0020 e 0202 — valores que o campo aceita, cada um uma consulta: o
 * vazio abre a ponta, e o ano curto volta 400 do servidor ou pisca a recusa do
 * período.
 *
 * O campo mostra cada tecla na hora (`campo`). Consulta, CSV, PDF e a recusa do
 * período leem `aplicados`, que só recebem o digitado quando a digitação para
 * por `PAUSA_DA_DIGITACAO_MS` — ou no Enter. Os campos aplicam juntos, num
 * timer só, e aplicar volta à página 1 no mesmo render: a primeira consulta do
 * valor novo já é a da página 1 (REPORTS-PAGE-RESET-ON-PERIOD-01), e o valor
 * que volta ao aplicado antes da pausa não consulta nada.
 *
 * Seletor e checkbox não passam por aqui: um clique é um valor só.
 */
export function useFiltrosDigitados<T extends Record<string, string>>(
  iniciais: T,
  setPage: (page: number) => void,
) {
  const [valores, setValores] = useState(iniciais);
  const [aplicados, setAplicados] = useState(iniciais);
  const pendente = Object.keys(valores).some((nome) => valores[nome] !== aplicados[nome]);

  useEffect(() => {
    if (!pendente) return;
    const timer = setTimeout(() => {
      setAplicados(valores);
      setPage(1);
    }, PAUSA_DA_DIGITACAO_MS);
    // Tecla nova recomeça a pausa; sair da tela não deixa consulta agendada.
    return () => clearTimeout(timer);
  }, [valores, pendente, setPage]);

  function aplicarAgora() {
    if (!pendente) return;
    setAplicados(valores);
    setPage(1);
  }

  /** `value`, `onChange` e Enter de um campo digitado. */
  function campo(nome: keyof T & string) {
    return {
      value: valores[nome],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const valor = event.target.value;
        setValores((atuais) => ({ ...atuais, [nome]: valor }));
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") aplicarAgora();
      },
    };
  }

  return { aplicados, pendente, campo };
}
