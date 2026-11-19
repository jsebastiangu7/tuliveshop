/* Factura PDF del cliente (se carga bajo demanda: jsPDF + autoTable + fuentes de la tienda) */
const pdfMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const STATUS_LABEL = { draft: 'Borrador', pending_confirm: 'Por confirmar', apartada: 'Apartada', paid: 'Pagada', shipped: 'Enviada', delivered: 'Entregada', canceled: 'Cancelada', expired: 'Vencida' };
function _loadScript(src) {
  return new Promise((ok, ko) => {
    if (document.querySelector('script[data-src="' + src + '"]')) return ok();
    const s = document.createElement('script'); s.src = src; s.dataset.src = src;
    s.onload = () => ok(); s.onerror = () => ko(new Error('No se pudo cargar el generador de PDF. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
}
async function ensureInvoiceLibs() {
  if (!(window.jspdf && window.jspdf.jsPDF)) await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (!(window.jspdf.jsPDF.API && typeof window.jspdf.jsPDF.API.autoTable === 'function')) await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
  if (typeof window.registerCustomFonts !== 'function') { try { await _loadScript('/invoice-fonts.js'); } catch (_) { /* sin fuentes propias: usa Helvetica */ } }
}

const FONT_MAP = {
  'Arial': 'Inter', 'Nunito': 'NunitoSans', 'Montserrat': 'Montserrat',
  'Perfect Lemonade': 'PerfectLemonade', 'Sweetbliss Personal Use': 'Sweetbliss',
  'Shortcake Strawberry': 'ShortcakeStrawberry', 'Mochibop': 'Mochibop',
};
async function clientInvoice(id, btn) {
  if (btn) btn.disabled = true;
  try {
    await ensureInvoiceLibs();
    const d = await api('/api/orders/' + id + '/invoice');
    buildClientPdf(d);
  } catch (e) { toast('⚠ ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}
function buildClientPdf(d) {
  const o = d.order, cfg = d.config || {}, client = d.client || {};
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasFonts = typeof window.registerCustomFonts === 'function';
  if (hasFonts) registerCustomFonts(doc);
  const green = [63, 125, 74], dark = [22, 22, 22], muted = [92, 106, 95], red = [192, 57, 43];
  const TF = hasFonts ? (FONT_MAP[cfg.fontTitulos] || FONT_MAP['Arial']) : 'helvetica';
  const BF = hasFonts ? (FONT_MAP[cfg.fontCuerpo] || FONT_MAP['Arial']) : 'helvetica';
  const setTitleFont = (st) => doc.setFont(TF, st || 'normal');
  const setBodyFont = (st) => doc.setFont(BF, st || 'normal');
  const tSup = hasFonts ? nTildeFallback(doc, TF) : { lower: true, upper: true };
  const bSup = hasFonts ? nTildeFallback(doc, BF) : { lower: true, upper: true };
  const tt = hasFonts ? (t) => applyNTildeFallback(t, tSup) : (t) => t;
  const bt = hasFonts ? (t) => applyNTildeFallback(t, bSup) : (t) => t;
  if (cfg.watermark && cfg.watermarkW && cfg.watermarkH) {
    try {
      const ratio = cfg.watermarkW / cfg.watermarkH;
      let w = 170, h = w / ratio; if (h > 257) { h = 257; w = h * ratio; }
      doc.setGState(new doc.GState({ opacity: 0.12 }));
      doc.addImage(cfg.watermark, /jpe?g/.test(cfg.watermark) ? 'JPEG' : 'PNG', (210 - w) / 2, (297 - h) / 2, w, h, undefined, 'FAST');
      doc.setGState(new doc.GState({ opacity: 1 }));
    } catch (e) { }
  }
  let y = 18;
  const drawCompanyName = () => { setTitleFont('bold'); doc.setFontSize(16); doc.setTextColor(...green); doc.text(tt(cfg.empresa || 'Pandala Kawaii'), 14, y + 4); };
  if (cfg.logo) { try { doc.addImage(cfg.logo, /jpe?g/.test(cfg.logo) ? 'JPEG' : 'PNG', 14, y - 6, 40, 22, undefined, 'FAST'); } catch (e) { drawCompanyName(); } }
  else drawCompanyName();
  setBodyFont('normal'); doc.setFontSize(9); doc.setTextColor(...muted);
  let iy = y + 18;
  const info = [];
  if (cfg.direccion) info.push(cfg.direccion);
  const contact = []; if (cfg.telefono) contact.push('Tel: ' + cfg.telefono); if (cfg.email) contact.push(cfg.email);
  if (contact.length) info.push(contact.join(' · '));
  if (cfg.nit) info.push('NIT/Doc: ' + cfg.nit);
  info.forEach(l => { doc.text(bt(l), 14, iy); iy += 4.5; });
  setTitleFont('bold'); doc.setFontSize(18); doc.setTextColor(...green);
  doc.text('FACTURA', 196, y + 2, { align: 'right' });
  setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
  doc.text('No. ' + o.order_number, 196, y + 9, { align: 'right' });
  doc.text('Fecha: ' + String(o.created_at || '').slice(0, 10), 196, y + 14, { align: 'right' });
  doc.text('Estado: ' + (STATUS_LABEL[o.status] || o.status), 196, y + 19, { align: 'right' });
  const lineY = Math.max(iy, y + 24) + 2;
  doc.setDrawColor(...green); doc.setLineWidth(0.6); doc.line(14, lineY, 196, lineY);
  let by = lineY + 8;
  setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
  doc.text('CLIENTE', 14, by);
  setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
  doc.text(bt(client.name || ''), 14, by + 6);
  doc.setFontSize(9); doc.setTextColor(...muted);
  let cy = by + 11;
  if (client.whatsapp) { doc.text(bt(String(client.whatsapp)), 14, cy); cy += 4.5; }
  if (client.city) { doc.text(bt('Ciudad: ' + client.city), 14, cy); cy += 4.5; }
  if (client.address) { doc.text(bt(String(client.address)), 14, cy); cy += 4.5; }
  doc.autoTable({
    startY: cy + 6,
    head: [['Producto', 'Fecha', 'Cant.', 'Precio Un.', 'Total']],
    body: d.items.map(i => [bt(i.kit_name ? ('Kit: ' + i.kit_name) : String(i.product_name || '')), String(i.added_at || '').slice(0, 10), String(i.quantity), pdfMoney(i.price), pdfMoney(i.price * i.quantity)]),
    theme: 'plain',
    styles: { font: BF, fontSize: 9, textColor: dark, cellPadding: 2.5 },
    headStyles: { font: TF, fontStyle: 'bold', fillColor: [233, 244, 234], textColor: [47, 95, 56] },
    columnStyles: { 1: { halign: 'center', cellWidth: 25 }, 2: { halign: 'center', cellWidth: 16 }, 3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 28 } },
    margin: { left: 14, right: 14 },
  });
  let ay = doc.lastAutoTable.finalY + 8;
  setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
  doc.text('Total pedido:', 150, ay); doc.text(pdfMoney(d.total), 196, ay, { align: 'right' });
  doc.text('Total abonado:', 150, ay + 6); doc.text(pdfMoney(d.paid), 196, ay + 6, { align: 'right' });
  doc.setDrawColor(...green); doc.line(150, ay + 9, 196, ay + 9);
  setBodyFont('bold'); doc.setFontSize(12); doc.setTextColor(...red);
  doc.text('Saldo:', 150, ay + 16); doc.text(pdfMoney(d.balance), 196, ay + 16, { align: 'right' });
  let py = ay + 26;
  setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
  doc.text('HISTORIAL DE ABONOS', 14, py);
  if (d.payments && d.payments.length) {
    doc.autoTable({
      startY: py + 3,
      head: [['Fecha', 'Medio', 'Referencia', 'Nota', 'Valor']],
      body: d.payments.map(p => [String(p.payment_date || ''), bt(String(p.method || '')), bt(String(p.reference || '—')), bt(String(p.note || '')), pdfMoney(p.amount)]),
      theme: 'plain',
      styles: { font: BF, fontSize: 8.5, textColor: dark, cellPadding: 2 },
      headStyles: { font: TF, fontStyle: 'bold', fillColor: [247, 250, 247], textColor: muted },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: 34 }, 4: { halign: 'right', cellWidth: 28 } },
      margin: { left: 14, right: 14 },
    });
    py = doc.lastAutoTable.finalY + 10;
  } else { setBodyFont('normal'); doc.setFontSize(9); doc.text('Sin abonos registrados', 14, py + 6); py += 16; }
  const nota = String(o.notes || '').trim();
  if (nota) {
    const lines = doc.splitTextToSize(bt(nota), 182);
    setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
    doc.text('NOTAS', 14, py);
    setBodyFont('normal'); doc.setTextColor(...dark);
    doc.text(lines, 14, py + 5);
  }
  const H = doc.internal.pageSize.getHeight();
  setBodyFont('italic'); doc.setFontSize(8.5); doc.setTextColor(...muted);
  doc.text(bt(cfg.mensaje || ''), 105, H - 12, { align: 'center' });
  doc.save('Factura_' + o.order_number + '.pdf');
  toast('✔ Factura descargada');
}

