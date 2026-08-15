import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LotScanner } from "./LotScanner";

describe("LotScanner", () => {
  it("normaliza espaços e chama onDetect ao digitar manualmente", async () => {
    const onDetect = vi.fn();
    const user = userEvent.setup();
    render(<LotScanner onDetect={onDetect} />);

    const input = screen.getByLabelText("Digite o lote");
    await user.type(input, "  LT-20260815-000123  ");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    expect(onDetect).toHaveBeenCalledWith("LT-20260815-000123");
  });

  it("não chama onDetect com campo vazio", async () => {
    const onDetect = vi.fn();
    render(<LotScanner onDetect={onDetect} />);

    expect(screen.getByRole("button", { name: "Buscar" })).toBeDisabled();
    expect(onDetect).not.toHaveBeenCalled();
  });

  it("nunca exige câmera — digitação manual sempre disponível", () => {
    render(<LotScanner onDetect={vi.fn()} />);

    expect(screen.getByLabelText("Digite o lote")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir câmera" })).toBeInTheDocument();
  });
});
