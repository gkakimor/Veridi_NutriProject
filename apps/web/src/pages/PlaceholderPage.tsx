interface PlaceholderPageProps {
  title: string;
}

/**
 * Placeholder de navegacao para modulos ainda nao implementados.
 * Nao simula dados nem telas. Cada modulo real entra por handoff proprio.
 */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">{title}</h1>
          <p className="page__subtitle">Módulo ainda não implementado.</p>
        </div>
      </div>

      <section className="card">
        <p className="muted">
          Esta tela existe apenas como navegação. A implementação entra em um
          handoff específico do módulo.
        </p>
      </section>
    </>
  );
}
