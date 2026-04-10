import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import { run, all } from '../db/connection.js';
import { getEfficiencyReport, countWeekRecs, getWeekStr, DIAS } from './routeEtaService.js';

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: '',
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export async function generateWeeklyRecommendations(sucursalesMap) {
  try {
    const existentes = await countWeekRecs();
    if (existentes >= 2) {
      return { ok: false, message: 'Ya se generaron las 2 recomendaciones de esta semana' };
    }

    const stats = await getEfficiencyReport();
    if (stats.length === 0) {
      return { ok: false, message: 'Aún no hay suficientes datos de rutas para generar recomendaciones' };
    }

    const resumen = stats
      .map((s) => {
        const origen = sucursalesMap[s.sucursal_origen_id] || 'Sucursal desconocida';
        const destino = sucursalesMap[s.sucursal_destino_id] || 'Sucursal desconocida';
        const porDia = Object.entries(s.promedio_por_dia)
          .map(([d, m]) => `${DIAS[d]}: ${Math.floor(m / 60)}h ${Math.round(m % 60)}m`)
          .join(', ');
        const h = Math.floor(s.promedio_general_minutos / 60);
        const m = Math.round(s.promedio_general_minutos % 60);
        return `• ${origen} → ${destino}: promedio ${h}h ${m}m (${s.muestras_totales} envíos, confianza: ${Math.round(s.confianza * 100)}%). Por día: [${porDia || 'sin datos por día'}]`;
      })
      .join('\n');

    const hoy = new Date();
    const diaHoy = DIAS[hoy.getDay()];

    const prompt = `Eres el asistente de logística de Astrapu, empresa de paquetería interprovincial en República Dominicana.

Datos reales de rendimiento de rutas esta semana:
${resumen}

Contexto (usa tu conocimiento sobre tráfico en RD):
- Hoy es ${diaHoy}
- Santo Domingo tiene tráfico intenso los lunes y viernes en horas pico (7-9am, 5-7pm)
- La Autopista Duarte (SDQ-Santiago) se congestiona los fines de semana
- Miércoles y jueves suelen tener menos tráfico
- La Carretera Sánchez y la vía La Romana son relativamente fluidas entre semana
- Feriados y fines de mes tienen más movimiento

Con base en los datos reales y el contexto de tráfico, genera EXACTAMENTE 2 recomendaciones operativas concretas, breves y útiles para el equipo de operaciones. Sé específico: menciona días, rutas o franjas horarias cuando ayude.

Responde ÚNICAMENTE con JSON válido, sin texto adicional antes ni después:
[
  {"tipo":"eficiencia","titulo":"Título corto (max 6 palabras)","mensaje":"Recomendación específica en 1-2 oraciones."},
  {"tipo":"trafico","titulo":"Título corto (max 6 palabras)","mensaje":"Recomendación específica en 1-2 oraciones."}
]`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 8192 },
    });

    const text = response.text || '';
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error('Gemini no devolvió JSON válido');

    const recs = JSON.parse(match[0]);
    const semana = getWeekStr();

    for (const rec of recs.slice(0, 2)) {
      await run(
        `INSERT INTO route_eta_recommendations(id, tipo, titulo, mensaje, datos_json, estado, semana)
         VALUES(?,?,?,?,?,?,?)`,
        [
          crypto.randomUUID(),
          rec.tipo || 'general',
          String(rec.titulo || '').slice(0, 120),
          String(rec.mensaje || '').slice(0, 500),
          JSON.stringify({ modelo: 'gemini-2.5-flash', semana }),
          'pendiente',
          semana,
        ],
      );
    }

    return { ok: true, generated: Math.min(recs.length, 2) };
  } catch (e) {
    console.error('[ETA Gemini]', e.message);
    return { ok: false, error: e.message };
  }
}
