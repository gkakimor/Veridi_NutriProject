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
 *
 * ### A conferência não depende de ninguém lembrar dela
 *
 * `esperado` era opcional, e omiti-lo desligava a checagem em silêncio. Foi o
 * que aconteceu na Formulação: a explicação da quantidade física mostrava
 * `22 kg × (1 + 23%) ÷ 99%`, que dá 27,33, ao lado do valor exibido de
 * 0,091111 kg — faltava a divisão pela base de 300. A conta estava certa no
 * motor; a explicação, não. E o alarme que existe exatamente para isso estava
 * dormindo porque o chamador não passou `esperado`.
 *
 * Agora, quando cada operando traz o seu `numero`, o componente REFAZ a conta a
 * partir do que está escrito na tela e compara com o resultado exibido. Um
 * fator esquecido na explicação passa a divergir do valor, que é precisamente
 * o defeito que se quer pegar. Quem não passa `numero` continua funcionando
 * como antes.
 */
export function CalcHint({
  label,
  operandos,
  resultado,
  esperado,
  nota,
  tolerancia,
}: {
  /** O valor explicado — vira o nome acessível ("Como calculamos Total da linha"). */
  label: string;
  /**
   * A conta, na ordem em que se lê. Cada operando traz o número JÁ FORMATADO
   * como aparece na tela e o nome do que ele é.
   */
  operandos: {
    valor: string;
    papel: string;
    operador?: string;
    /**
     * O operando em número. Com ele em TODOS os operandos, o componente refaz
     * a conta e confere a própria explicação sem `esperado`.
     */
    numero?: number;
  }[];
  /** O resultado como a tela o exibe. */
  resultado: string;
  /**
   * O resultado da operação em número, quando dá para calcular. Serve para o
   * componente conferir a própria explicação; omitir desliga a conferência.
   */
  esperado?: number | null;
  /** Uma linha sobre a origem de algum operando — de onde veio o custo, por exemplo. */
  nota?: string;
  /**
   * Folga da conferência. Sem valor, sai da precisão EXIBIDA: metade da última
   * casa mostrada. Um total em reais aceita meio centavo; uma quantidade com
   * seis casas aceita meio milionésimo. Uma folga fixa de meio centavo sobre
   * 0,091111 kg seria 5% do valor — larga demais para pegar erro nenhum.
   */
  tolerancia?: number;
}) {
  const numeroDoTexto = (texto: string): number => {
    const limpo = texto
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}\b)/g, "")
      .replace(",", ".");
    return Number(limpo);
  };

  /** Refaz a conta escrita na tela, quando ela é refazível. */
  const daExplicacao = (): number | null => {
    if (operandos.length === 0 || operandos.some((o) => typeof o.numero !== "number")) return null;
    let acumulado = operandos[0]!.numero!;
    for (const operando of operandos.slice(1)) {
      const n = operando.numero!;
      switch (operando.operador ?? "×") {
        case "÷":
          if (n === 0) return null;
          acumulado /= n;
          break;
        case "+":
          acumulado += n;
          break;
        case "−":
        case "-":
          acumulado -= n;
          break;
        default:
          acumulado *= n;
      }
    }
    return Number.isFinite(acumulado) ? acumulado : null;
  };

  const casasExibidas = (texto: string): number => {
    const parte = texto.match(/[.,](\d+)/);
    return parte ? parte[1]!.length : 2;
  };

  const exibido = numeroDoTexto(resultado);
  const alvo = esperado ?? daExplicacao();
  const folga = tolerancia ?? 0.5 * 10 ** -casasExibidas(resultado);
  const confere =
    alvo === undefined || alvo === null || Number.isNaN(exibido)
      ? null
      : Math.abs(alvo - exibido) <= folga;

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
