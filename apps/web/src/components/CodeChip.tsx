import type { ReactNode } from "react";

interface CodeChipProps {
  children: ReactNode;
}

/** Chip escuro com texto lima em `--font-code` — codigo interno imutavel. */
export function CodeChip({ children }: CodeChipProps) {
  return <span className="code-chip">{children}</span>;
}
