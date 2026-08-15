import type { LotDTO } from "@veridi/shared";
import { QrCode } from "../../components/QrCode";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/**
 * Conteúdo da etiqueta de lote — humano-legível sem scanner. NÃO inclui
 * saldo disponível, reservado, preço, OC completa ou dado financeiro.
 */
export function LotLabel({ lot }: { lot: LotDTO }) {
  return (
    <div className="lot-label">
      <div className="lot-label__header">VERIDI NUTRITION</div>

      <div className="lot-label__item">
        <span className="lot-label__item-code">{lot.itemCode}</span>
        <span className="lot-label__item-name">{lot.itemName}</span>
      </div>

      <div className="lot-label__body">
        <dl className="lot-label__fields">
          <dt>Lote fornecedor</dt>
          <dd>{lot.supplierLot ?? "—"}</dd>
          <dt>Lote interno</dt>
          <dd>{lot.code}</dd>
          <dt>Validade</dt>
          <dd>
            {formatDate(lot.expiryDate)}
            {lot.isExpired && <span className="lot-label__expired"> — VENCIDO</span>}
          </dd>
          <dt>Quantidade recebida</dt>
          <dd>
            {lot.initialReceivedQuantity} {lot.unitCode}
          </dd>
          <dt>Localização</dt>
          <dd>{lot.location ?? "—"}</dd>
        </dl>

        <div className="lot-label__qr">
          <QrCode value={lot.qrPayload} size={92} label={`Código QR do lote ${lot.code}`} />
        </div>
      </div>
    </div>
  );
}
