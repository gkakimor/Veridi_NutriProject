import { Link, useLocation } from "react-router-dom";

/**
 * Endereço que não existe.
 *
 * Antes, qualquer rota desconhecida caía em `<Navigate to="/" replace />`: o
 * sistema trocava o endereço em silêncio e a pessoa aterrissava no Dashboard
 * sem saber que tinha errado o caminho — link antigo, endereço digitado com
 * um caractere a mais, favorito de uma rota que mudou de nome. Pior, o
 * `replace` apagava o endereço errado do histórico, então nem voltar mostrava
 * o que tinha sido pedido, e não sobrava nada para copiar em um chamado.
 *
 * A página diz o que houve, mostra o endereço que não existe e oferece o
 * caminho de volta — o mesmo desenho que Lote, Pedido e Ordem de Compra já
 * usam quando o documento não é encontrado.
 */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="page__header">
      <div>
        <h1 className="page__title">Página não encontrada</h1>
        <p className="page__subtitle">
          O endereço <span className="code">{location.pathname}</span> não existe no Veridi. Ele
          pode ter mudado de nome, ou o link que trouxe você até aqui está desatualizado.
        </p>
        {/* Voltar é navegação, não ação: link de verdade, com endereço no
            href — a mesma regra que esta entrega aplicou nas outras telas. */}
        <Link className="btn btn--ghost" to="/">
          ← Voltar para o Dashboard
        </Link>
      </div>
    </div>
  );
}
