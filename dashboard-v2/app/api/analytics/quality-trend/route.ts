import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

interface QualityEntry { ts: number; avgScore: number; }
type QualityData = Record<string, QualityEntry[]>;

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const filePath = path.resolve(process.cwd(), '..', 'analytics', 'quality-feedback.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as QualityData;

    const categories = Object.keys(data);
    // aggregate: average multiple entries on the same date per category
    const dateMap: Record<string, Record<string, { sum: number; count: number }>> = {};

    categories.forEach(cat => {
      data[cat].forEach(entry => {
        if (!Number.isFinite(entry.avgScore)) return;
        const date = new Date(entry.ts).toISOString().slice(0, 10);
        if (!dateMap[date]) dateMap[date] = {};
        if (!dateMap[date][cat]) dateMap[date][cat] = { sum: 0, count: 0 };
        dateMap[date][cat].sum += entry.avgScore;
        dateMap[date][cat].count++;
      });
    });

    const series = Object.entries(dateMap)
      .map(([date, cats]) => {
        const row: Record<string, number | string> = { date };
        Object.entries(cats).forEach(([cat, { sum, count }]) => {
          row[cat] = parseFloat((sum / count).toFixed(1));
        });
        return row;
      })
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));

    return NextResponse.json({ categories, series });
  } catch (err) {
    console.error('[quality-trend]', err);
    return NextResponse.json({ error: 'failed to read quality data' }, { status: 500 });
  }
}
