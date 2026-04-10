import { printThermalTicket, printAdhesiveLabel } from './qzService.js';
import { db } from '../data/store.js';

export async function printSaleDocuments(ticketData, labelData) {
  const start = new Date().toISOString();
  const thermal = await printThermalTicket(ticketData);
  const label = await printAdhesiveLabel(labelData);

  db.historial_impresion.unshift({
    id: `imp-${db.historial_impresion.length + 1}`,
    fecha_hora: start,
    guia: ticketData.guia,
    ticket_ok: thermal.ok,
    etiqueta_ok: label.ok,
    error_ticket: thermal.error || null,
    error_etiqueta: label.error || null,
  });

  return {
    ok: thermal.ok && label.ok,
    thermal,
    label,
    message: !thermal.ok
      ? `Falló ticket: ${thermal.error}`
      : !label.ok
        ? `Falló etiqueta: ${label.error}`
        : 'Impresión completada',
  };
}
