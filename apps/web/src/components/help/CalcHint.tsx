import { InfoHint } from "./InfoHint";

/**
 * "Como este número foi calculado" — com os números DESTA linha.
 *
 * Fórmula abstrata não responde a pergunta que o operador faz. Ele não quer
 * saber que o total é quantidade vezes preço: ele quer saber por que ESTE
 * total é R$ 498,53. A diferença entre as duas coisas custou um HIGH nesta
 * base — o faturamento exibia `R$ 4,05` ao lado de um total calculado sobre
 * `4,0531`, e quem conferia com a calculadora chegava a outro número sem ter
 * como descobrir de onde vinha a diferença.
 *
 * Por isso a conta aparece com os valores já formatados, na mesma precisão em
 * que estão na tela: o que se lê aqui tem de ser refazível à mão.
 *
 * ## O componente confere o que explica
 *
 * `esperado` recebe o resultado numérico da operação e `resultado` o que a
 * tela mostra. Quando os dois divergem além da tolerância, a explicação diz
 * isso em vez de apresentar uma conta que não fecha. Uma ajuda que afirma uma
 * aritmética falsa é pior que ajuda nenhuma: ela convence.
 */
export function CalcHint({
  label,
  operandos,
  resultado,
  esperado,
  nota,
  tolerancia = 0.005,
}: {
  /** O valor explicado — vira o nome acessível ("Como calculamos Total da linha"). */
  label: string;
  /**
   * A conta, na ordem em que se lê. Cada operando traz o número JÁ FORMATADO
   * como aparece na tela e o nome do que ele é.
   */
  operandos: { valor: string; papel: string; operador?: string }[];
  /** O resultado como a tela o exibe. */
  resultado: string;
  /**
   * O resultado da operação em número, quando dá para calcular. Serve para o
   * componente conferir a própria explicação; omitir desliga a conferência.
   */
  esperado?: number | null;
  /** Uma linha sobre a origem de algum operando — de onde veio o custo, por exemplo. */
  nota?: string;
  /** Folga da conferência. O padrão aceita meio centavo. */
  tolerancia?: number;
}) {
  const numeroDoTexto = (texto: string): number => {
    const limpo = texto
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}\b)/g, "")
      .replace(",", ".");
    return Number(limpo);
  };

  const exibido = numeroDoTexto(resultado);
  const confere =
    esperado === undefined || esperado === null || Number.isNaN(exibido)
      ? null
      : Math.abs(esperado - exibido) <= tolerancia;

  return (
    <InfoHint label={label}>
      <p className="calc-hint__titulo">Como este valor foi calculado</p>
      <p className="calc-hint__conta">
        {operandos.map((operando, indice) => (
          <span key={`${operando.papel}-${indice}`}>
            {indice > 0 && <span className="calc-hint__op"> {operando.operador ?? "×"} </span>}
            <span className="calc-hint__valor">{operando.valor}</span>
            <span className="calc-hint__papel"> ({operando.papel})</span>
          </span>
        ))}
        <span className="calc-hint__op"> = </span>
        <span className="calc-hint__valor">{resultado}</span>
      </p>
      {nota && <p className="calc-hint__nota">{nota}</p>}
      {confere === false && (
        /*
         * Divergência é dita, nunca escondida. Se a conta apresentada não
         * chega ao número exibido, o problema é do cálculo ou da explicação —
         * e as duas hipóteses precisam do operador sabendo que existem.
         */
        <p className="calc-hint__divergencia" role="alert">
          A conta acima não fecha com o valor exibido. Confira antes de usar
          este número.
        </p>
      )}
    </InfoHint>
  );
}
