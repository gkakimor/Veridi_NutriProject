import type { ReactNode } from "react";

interface FormSectionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Bloco de secao dentro de um formulario de modal fullscreen. */
export function FormSection({ title, subtitle, children }: FormSectionProps) {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      {subtitle && <p className="form-section__sub">{subtitle}</p>}
      {children}
    </section>
  );
}
