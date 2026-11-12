// Extrae las fuentes decorativas (base64) desde tu app actual y crea public/invoice-fonts.js
// Uso desde la carpeta server:  node extract-fonts.mjs "C:\ruta\a\tu\AdministradorEmprendedor.html"
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Indica la ruta del HTML actual, ej: node extract-fonts.mjs "C:\\AdminventasQ\\legacy.html"');
  process.exit(1);
}
const html = fs.readFileSync(src, 'utf8');
const start = html.indexOf('const FONT_B64_INTER');
const end = html.indexOf('function generateInvoice(');
if (start < 0 || end < 0 || end < start) {
  console.error('No encontré las fuentes en ese archivo (busco FONT_B64_INTER y generateInvoice). Verifica que sea el HTML completo.');
  process.exit(1);
}
const chunk = html.slice(start, end).trim();
const out = `/* Fuentes decorativas de facturas (extraídas de Administrador Emprendedor). No editar a mano. */\n${chunk}\n`;
const dest = path.join(process.cwd(), 'public', 'invoice-fonts.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');
console.log('✔ public/invoice-fonts.js creado (' + (out.length / 1024).toFixed(0) + ' KB)');