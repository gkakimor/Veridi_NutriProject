import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  CustomerOrderDTO,
  CustomerOrderLineDTO,
  ProjectStatus,
  QuoteVersionDTO,
} from "@veridi/shared";
import { QuoteClosingSection } from "./QuoteClosingSection";
import { AgreedPriceCell, CommercialOriginSection } from "../customer-orders/CommercialOriginSection";

/**
 * P1 — o caminho do "sim" do cliente até o pedido, e de volta.
 *
 * Estes testes protegem a leitura: quem aceita a proposta precisa ver o que
 * ainda falta, quem abre o pedido precisa ver de onde ele veio, e as duas
 * telas precisam se alcançar por link de identidade — nunca por busca.
 */

function quote(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000700",
    projectId: "prj-1",
    versionNumber: 2,
    versionLabel: "ORC-000700 · V2",
    status: "ACCEPTED",
    lines: [],
    total: "9000.00",
    subtotal: "10000.00",
    discountPercent: "10.0000",
    paymentMethod: "CASH",
    downPaymentPercent: null,
    installmentCount: null,
    installmentIntervalDays: null,
    monthlyInterestPercent: null,
    paymentSchedule: null,
    sourcedOrder: null,
    ...overrides,
  } as unknown as QuoteVersionDTO;
}

function renderClosing(
  q: QuoteVersionDTO,
  projectStatus: ProjectStatus,
  onGenerate = vi.fn(),
  canEdit = true,
) {
  render(
    <MemoryRouter>
      <QuoteClosingSection
        quote={q}
        projectId="prj-1"
        projectStatus={projectStatus}
        canEdit={canEdit}
        saving={false}
        onGenerate={onGenerate}
      />
    </MemoryRouter>,
  );
  return onGenerate;
}

describe("Fechamento da proposta aceita", () => {
  it("com o projeto aprovado, oferece gerar o pedido", () => {
    const gerar = renderClosing(quote(), "APPROVED");

    expect(screen.getByText("Aprovado")).toBeInTheDocument();
    expect(screen.getByText("Ainda não gerado")).toBeInTheDocument();

    const botao = screen.getByRole("button", { name: /Gerar pedido a partir do orçamento/i });
    fireEvent.click(botao);
    expect(gerar).toHaveBeenCalledTimes(1);
  });

  it("antes da aprovação, explica o que falta em vez de oferecer o botão", () => {
    renderClosing(quote(), "WAITING");

    // Ação impossível não deve ser oferecida.
    expect(
      screen.queryByRole("button", { name: /Gerar pedido/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Aprove o projeto para liberá-los/i)).toBeInTheDocument();
    expect(screen.getByText(/Ainda precisa de aprovação/i)).toBeInTheDocument();
  });

  it("com pedido já gerado, abre o existente e não oferece gerar de novo", () => {
    renderClosing(
      quote({
        sourcedOrder: {
          id: "ord-9",
          code: "PED-002600",
          status: "DRAFT",
          createdAt: "2026-08-19T00:00:00.000Z",
        },
      }),
      "APPROVED",
    );

    // Sem duplicação por acidente: o caminho passa a ser abrir.
    expect(screen.queryByRole("button", { name: /Gerar pedido/i })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Abrir pedido PED-002600/i });
    expect(link).toHaveAttribute("href", "/comercial/pedidos/ord-9");
  });

  it("quem não pode escrever vê a situação, mas nenhuma ação", () => {
    renderClosing(quote(), "APPROVED", vi.fn(), false);

    expect(screen.getByText("Aprovado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gerar pedido/i })).not.toBeInTheDocument();
  });

  it("proposta não aceita não mostra fechamento nenhum", () => {
    const { container } = render(
      <MemoryRouter>
        <QuoteClosingSection
          quote={quote({ status: "SENT" })}
          projectId="prj-1"
          projectStatus="WAITING"
          canEdit
          saving={false}
          onGenerate={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

function linha(overrides: Partial<CustomerOrderLineDTO> = {}): CustomerOrderLineDTO {
  return {
    id: "col-1",
    productId: "prod-a",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    orderedQuantity: "500",
    unitCode: "un",
    position: 0,
    shippedQuantity: "0",
    outstandingQuantity: "500",
    billedQuantity: "0",
    unbilledShippedQuantity: "0",
    sourceQuoteLineId: "ql-1",
    agreedPrice: {
      unitPrice: "20.0000",
      lineTotal: "10000.00",
      source: "PRICING_TIER",
      pricingVersionId: "prec-1",
      pricingCode: "PREC-000444",
      pricingVersionNumber: 1,
      pricingTierId: "tier-1",
      tierQuantity: "500",
      tierUomCode: "un",
    },
    ...overrides,
  } as unknown as CustomerOrderLineDTO;
}

function order(overrides: Partial<CustomerOrderDTO> = {}): CustomerOrderDTO {
  return {
    id: "ord-9",
    code: "PED-002600",
    status: "DRAFT",
    lines: [linha()],
    commercialOrigin: {
      quoteVersionId: "q1",
      quoteCode: "ORC-000700",
      quoteVersionNumber: 2,
      projectId: "prj-1",
      projectCode: "PROJ-001414",
      subtotalAmount: "10000.00",
      discountPercent: "10.0000",
      totalAmount: "9000.00",
      paymentSchedule: {
        subtotal: "10000.00",
        discountPercent: "10.0000",
        discountAmount: "1000.00",
        total: "9000.00",
        method: "INSTALLMENTS",
        downPaymentPercent: "25.0000",
        downPayment: "2250.00",
        financedAmount: "6750.00",
        monthlyInterestPercent: "1.5000",
        installmentIntervalDays: 30,
        installments: [
          { number: 1, amount: "2318.02", dueInDays: 30 },
          { number: 2, amount: "2318.02", dueInDays: 60 },
          { number: 3, amount: "2318.02", dueInDays: 90 },
        ],
        totalPayable: "9204.06",
        interestAmount: "204.06",
      },
    },
    ...overrides,
  } as unknown as CustomerOrderDTO;
}

describe("Origem comercial do pedido", () => {
  it("mostra orçamento, projeto, total acordado e condição de pagamento", () => {
    render(
      <MemoryRouter>
        <CommercialOriginSection order={order()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("ORC-000700 · V2")).toBeInTheDocument();
    expect(screen.getByText("PROJ-001414")).toBeInTheDocument();
    expect(screen.getByText("Aceito pelo cliente")).toBeInTheDocument();
    expect(screen.getByText("R$ 9.000,00")).toBeInTheDocument();
    expect(screen.getByText(/entrada de R\$ 2.250,00 e 3× de R\$ 2.318,02/)).toBeInTheDocument();
    expect(screen.getByText(/juros de 1,5% ao mês/)).toBeInTheDocument();
  });

  it("liga o pedido de volta ao orçamento e ao projeto por identidade", () => {
    render(
      <MemoryRouter>
        <CommercialOriginSection order={order()} />
      </MemoryRouter>,
    );

    // Link por id, nunca busca textual.
    expect(screen.getByRole("link", { name: "ORC-000700 · V2" })).toHaveAttribute(
      "href",
      "/comercial/projetos/prj-1?quoteVersionId=q1",
    );
    expect(screen.getByRole("link", { name: "PROJ-001414" })).toHaveAttribute(
      "href",
      "/comercial/projetos/prj-1",
    );
  });

  it("deixa o plano de parcelas consultável sem sair da tela", () => {
    render(
      <MemoryRouter>
        <CommercialOriginSection order={order()} />
      </MemoryRouter>,
    );

    const detalhe = screen.getByText(/Ver o plano de pagamento acordado/i);
    expect(detalhe).toBeInTheDocument();
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Entrada")).toBeInTheDocument();
    expect(within(tabela).getAllByText("R$ 2.318,02")).toHaveLength(3);
    expect(within(tabela).getByText("90 dias")).toBeInTheDocument();
  });

  it("pedido criado direto diz que não tem orçamento de origem", () => {
    render(
      <MemoryRouter>
        <CommercialOriginSection
          order={order({ commercialOrigin: null, lines: [linha({ agreedPrice: null })] })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Pedido criado diretamente/i)).toBeInTheDocument();
    expect(screen.getByText(/Não há proposta vinculada/i)).toBeInTheDocument();
    // Sem inventar um acordo que não houve.
    expect(screen.queryByText(/Total acordado/i)).not.toBeInTheDocument();
  });

  it("não expõe custo, margem nem markup do orçamento", () => {
    const { container } = render(
      <MemoryRouter>
        <CommercialOriginSection order={order()} />
      </MemoryRouter>,
    );

    // Economics interno é do orçamento e não atravessa para o pedido.
    const texto = container.textContent ?? "";
    for (const proibido of ["margem", "markup", "contribuição", "CMV", "CALC-", "custo industrial"]) {
      expect(texto.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });

  it("proposta à vista não anuncia parcelas", () => {
    render(
      <MemoryRouter>
        <CommercialOriginSection
          order={order({
            commercialOrigin: {
              ...order().commercialOrigin!,
              paymentSchedule: {
                ...order().commercialOrigin!.paymentSchedule!,
                method: "CASH",
                installments: [],
                downPayment: null,
                monthlyInterestPercent: null,
                totalPayable: "9000.00",
              },
            },
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("À vista")).toBeInTheDocument();
    expect(screen.queryByText(/Total a prazo/i)).not.toBeInTheDocument();
  });
});

describe("Preço acordado nas linhas do pedido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preço vindo de faixa mostra a precificação e a faixa usada", () => {
    render(<AgreedPriceCell price={linha().agreedPrice} />);

    expect(screen.getByText("R$ 20,00")).toBeInTheDocument();
    expect(screen.getByText("PREC-000444 · faixa 500 un")).toBeInTheDocument();
  });

  it("preço manual continua manual, sem precificação inventada", () => {
    render(
      <AgreedPriceCell
        price={
          linha({
            agreedPrice: {
              unitPrice: "31.5000",
              lineTotal: "15750.00",
              source: "MANUAL",
              pricingVersionId: null,
              pricingCode: null,
              pricingVersionNumber: null,
              pricingTierId: null,
              tierQuantity: null,
              tierUomCode: null,
            },
          }).agreedPrice
        }
      />,
    );

    expect(screen.getByText("R$ 31,50")).toBeInTheDocument();
    expect(screen.getByText("Preço manual")).toBeInTheDocument();
    expect(screen.queryByText(/PREC-/)).not.toBeInTheDocument();
  });

  it("linha sem acordo não inventa preço", () => {
    render(<AgreedPriceCell price={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("multiproduto: cada linha carrega o próprio preço e a própria origem", () => {
    const pedido = order({
      lines: [
        linha(),
        linha({
          id: "col-2",
          productId: "prod-b",
          productCode: "PROD-000009",
          agreedPrice: {
            unitPrice: "35.0000",
            lineTotal: "10500.00",
            source: "PRICING_TIER",
            pricingVersionId: "prec-2",
            pricingCode: "PREC-000500",
            pricingVersionNumber: 1,
            pricingTierId: "tier-2",
            tierQuantity: "300",
            tierUomCode: "un",
          },
        }),
      ],
    });

    render(
      <MemoryRouter>
        <div>
          {pedido.lines.map((l) => (
            <p key={l.id}>
              <AgreedPriceCell price={l.agreedPrice} />
            </p>
          ))}
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByText("PREC-000444 · faixa 500 un")).toBeInTheDocument();
    expect(screen.getByText("PREC-000500 · faixa 300 un")).toBeInTheDocument();
    expect(screen.getByText("R$ 20,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 35,00")).toBeInTheDocument();
  });
});
