import type { ReactNode } from "react";

interface FormSectionProps {
  title: string;
  subtitle?: string;
  /** Âncora para links de "onde resolver" apontarem para a seção certa. */
  id?: string;
  children: ReactNode;
}

/** Bloco de secao dentro de um formulario de modal fullscreen. */
export function FormSection({ title, subtitle, id, children }: FormSectionProps) {
  return (
    <section className="form-section" id={id}>
      <h3>{title}</h3>
      {subtitle && <p className="form-section__sub">{subtitle}</p>}
      {children}
    </section>
  );
}
