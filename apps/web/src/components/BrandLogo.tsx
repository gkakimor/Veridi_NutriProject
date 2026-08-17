import logoUrl from "../assets/brand/veridi-logo.png";
import symbolUrl from "../assets/brand/veridi-symbol.png";

/**
 * Marca oficial da Veridi Nutrition.
 *
 * O asset é LOCAL e entra no bundle: nenhum documento impresso depende de
 * request externa para exibir a marca — papel gerado offline continua
 * correto, e nada vaza para fora ao imprimir.
 *
 * `full` é a assinatura horizontal (símbolo + wordmark), usada em fundo
 * claro (impressão). `symbol` é o símbolo isolado, usado onde o fundo
 * escuro engoliria o wordmark em verde-escuro do arquivo oficial.
 */
export function BrandLogo({
  variant = "full",
  className,
  height,
}: {
  variant?: "full" | "symbol";
  className?: string;
  height?: number;
}) {
  const isSymbol = variant === "symbol";
  return (
    <img
      src={isSymbol ? symbolUrl : logoUrl}
      alt="Veridi Nutrition"
      className={className}
      {...(height !== undefined ? { height } : {})}
    />
  );
}
