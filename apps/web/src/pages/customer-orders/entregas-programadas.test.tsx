import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOrderDeliveryScheduleDTO } from "@veridi/shared";

/**
 * Entregas programadas na tela do Pedido.
 *
 * O que se protege aqui é a leitura, não a aritmética — essa vive em
 * `packages/shared` e no serviço. A tela precisa: distinguir os seis saldos
 * com rótulos que dizem qual é qual, antecipar a recusa do excesso ANTES do
 * envio, e continuar mostrando a execução histórica de uma entrega cancelada.
 */

vi.mock("../../lib/delivery-schedule-api", () => ({
  getDeliverySchedule: vi.fn(),
  createDeliverySchedule: vi.fn(),
  cancelDeliverySchedule: vi.fn(),
  rescheduleDelivery: vi.fn(),
  prepareShipmentForDelivery: vi.fn(),
}));

const { createDeliverySchedule, getDeliverySchedule } = await import(
  "../../lib/delivery-schedule-api"
);
const { DeliveryScheduleSection } = await import("./DeliveryScheduleSection");

const LINHA = "line-1";

function cronograma(
  overrides: Partial<CustomerOrderDeliveryScheduleDTO> = {},
): CustomerOrderDeliveryScheduleDTO {
  return {
    deliveries: [],
    schedulable: [
      {
        customerOrderLineId: LINHA,
        productId: "prod-1",
        productCode: "PROD-000001",
        productName: "Whey Protein",
        unitCode: "un",
        orderedQuantity: "1000",
        shippedQuantity: "0",
        scheduledPendingQuantity: "0",
        schedulableQuantity: "1000",
      },
    ],
    ...overrides,
  };
}

function entrega(
  overrides: Partial<CustomerOrderDeliveryScheduleDTO["deliveries"][number]> = {},
): CustomerOrderDeliveryScheduleDTO["deliveries"][number] {
  return {
    id: "entrega-1",
    customerOrderId: "pedido-1",
    sequence: 1,
    scheduledDate: "2026-10-15",
    notes: null,
    status: "SCHEDULED",
    lines: [
      {
        id: "dl-1",
        customerOrderLineId: LINHA,
        productId: "prod-1",
        productCode: "PROD-000001",
        productName: "Whey Protein",
        unitCode: "un",
        quantity: "400",
        fulfilledQuantity: "0",
        remainingQuantity: "400",
      },
    ],
    shipments: [],
    totalQuantity: "400",
    totalFulfilledQuantity: "0",
    totalRemainingQuantity: "400",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    replacesDeliveryId: null,
    replacesDeliverySequence: null,
    replacedByDeliveryId: null,
    replacedByDeliverySequence: null,
    createdAt: "2026-09-09T12:00:00.000Z",
    createdBy: "Teste",
    ...overrides,
  };
}

function renderSecao(editable = true) {
  render(
    <MemoryRouter>
      <DeliveryScheduleSection customerOrderId="pedido-1" editable={editable} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("seção de entregas programadas", () => {
  it("diz que não há cronograma sem sugerir que o pedido está travado", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(cronograma());
    renderSecao();

    expect(await screen.findByText(/Nenhuma entrega programada/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adicionar entrega programada" }),
    ).toBeInTheDocument();
  });

  it("mostra a entrega com data, situação e os três números do progresso", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(
      cronograma({
        deliveries: [
          entrega({
            status: "PARTIALLY_FULFILLED",
            totalFulfilledQuantity: "250",
            totalRemainingQuantity: "150",
          }),
        ],
      }),
    );
    renderSecao();

    await screen.findByText("Parcialmente atendida");
    const linha = screen.getByRole("button", { name: "Entrega 1" }).closest("tr")!;
    expect(linha.textContent).toContain("15/10/2026");
    expect(linha.textContent).toContain("400");
    expect(linha.textContent).toContain("250");
    expect(linha.textContent).toContain("150");
  });

  /**
   * Os seis saldos do Pedido têm nomes diferentes de propósito: chamar todos
   * de "saldo" é o defeito que o handoff proíbe.
   */
  it("nomeia cada saldo pelo que ele é", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(cronograma());
    renderSecao();

    await userEvent.click(
      await screen.findByRole("button", { name: "Adicionar entrega programada" }),
    );

    expect(screen.getByRole("columnheader", { name: "Pedido" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Já expedido" })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Já programado pendente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Disponível para programar" }),
    ).toBeInTheDocument();
  });

  it("antecipa a recusa do excesso e não deixa salvar", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(cronograma());
    renderSecao();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Adicionar entrega programada" }));

    await user.type(screen.getByLabelText(/Data programada/), "2026-10-15");
    await user.type(screen.getByLabelText("Programar PROD-000001"), "1200");

    expect(await screen.findByText(/Quantidade acima do saldo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar entrega" })).toBeDisabled();
    expect(createDeliverySchedule).not.toHaveBeenCalled();
  });

  it("envia a entrega válida com data e quantidade por linha", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(cronograma());
    vi.mocked(createDeliverySchedule).mockResolvedValue(
      cronograma({ deliveries: [entrega()] }),
    );
    renderSecao();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Adicionar entrega programada" }));
    await user.type(screen.getByLabelText(/Data programada/), "2026-10-15");
    await user.type(screen.getByLabelText("Programar PROD-000001"), "400");
    await user.click(screen.getByRole("button", { name: "Salvar entrega" }));

    await waitFor(() =>
      expect(createDeliverySchedule).toHaveBeenCalledWith("pedido-1", {
        scheduledDate: "2026-10-15",
        lines: [{ customerOrderLineId: LINHA, quantity: "400" }],
      }),
    );
  });

  /**
   * A decisão do PO: cancelar não apaga execução. A entrega cancelada continua
   * mostrando o que saiu antes — 250 de 400 — e o motivo.
   */
  it("entrega cancelada continua mostrando o que foi atendido antes", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(
      cronograma({
        deliveries: [
          entrega({
            status: "CANCELLED",
            totalFulfilledQuantity: "250",
            totalRemainingQuantity: "150",
            cancelledAt: "2026-09-09T12:00:00.000Z",
            cancelReason: "Cliente cancelou o restante",
            shipments: [
              {
                shipmentId: "exp-1",
                shipmentCode: "EXP-000010",
                status: "CONFIRMED",
                shipmentDate: "2026-09-09T12:00:00.000Z",
                quantity: "250",
              },
            ],
          }),
        ],
      }),
    );
    renderSecao();

    await screen.findByText("Cancelada");
    await userEvent.click(screen.getByRole("button", { name: "Entrega 1" }));

    expect(screen.getByText(/Motivo do cancelamento: Cliente cancelou o restante/)).toBeInTheDocument();
    expect(screen.getByText(/EXP-000010/)).toBeInTheDocument();
    // Nem cancelar nem reprogramar são oferecidos: a promessa já acabou.
    expect(screen.queryByRole("button", { name: "Reprogramar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("entrega atendida não oferece reprogramar nem cancelar", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(
      cronograma({
        deliveries: [
          entrega({
            status: "FULFILLED",
            totalFulfilledQuantity: "400",
            totalRemainingQuantity: "0",
          }),
        ],
      }),
    );
    renderSecao();

    await screen.findByText("Atendida");
    expect(screen.queryByRole("button", { name: "Reprogramar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preparar expedição" })).toBeNull();
  });

  it("mostra a cadeia de reprogramação nas duas pontas", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(
      cronograma({
        deliveries: [
          entrega({
            id: "entrega-1",
            sequence: 1,
            status: "CANCELLED",
            replacedByDeliveryId: "entrega-2",
            replacedByDeliverySequence: 2,
          }),
          entrega({
            id: "entrega-2",
            sequence: 2,
            scheduledDate: "2026-11-15",
            replacesDeliveryId: "entrega-1",
            replacesDeliverySequence: 1,
          }),
        ],
      }),
    );
    renderSecao();

    await screen.findByText(/reprogramada para a 2/);
    expect(screen.getByText(/substitui a 1/)).toBeInTheDocument();
  });

  it("pedido sem edição não oferece nenhuma ação", async () => {
    vi.mocked(getDeliverySchedule).mockResolvedValue(
      cronograma({ deliveries: [entrega()] }),
    );
    renderSecao(false);

    await screen.findByText("Programada");
    expect(screen.queryByRole("button", { name: "Adicionar entrega programada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preparar expedição" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });
});
