import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getProduct } from "../lib/products-api";

/**
 * Caminho de volta ao projeto que originou o produto.
 *
 * Formulação, estrutura de custos, cálculo e precificação são telas do
 * PRODUTO, mas quem chega nelas normalmente veio de um projeto — e antes
 * disso só o botão "voltar" do navegador trazia de volta. Produto legado
 * (sem `originProjectId`) não mostra link nenhum: nada de adivinhar origem.
 */
export function ProjectOriginLink({ productId }: { productId: string | null | undefined }) {
  const [origin, setOrigin] = useState<{ id: string; code: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (!productId) {
      setOrigin(null);
      return;
    }
    getProduct(productId)
      .then((product) => {
        if (!active) return;
        setOrigin(
          product.originProjectId && product.originProjectCode
            ? { id: product.originProjectId, code: product.originProjectCode }
            : null,
        );
      })
      .catch(() => {
        if (active) setOrigin(null);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (!origin) return null;

  return (
    <Link className="btn btn--ghost btn--sm" to={`/comercial/projetos/${origin.id}`}>
      ← Voltar ao projeto <span className="code">{origin.code}</span>
    </Link>
  );
}
