import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

const SHEET_ID = process.env.GOOGLE_SHEETS_SHEET_ID!;
const SHEET_NAMES = ['취타', '미락흘', '도드리', '축제', '플투스'];

const RULES: Record<string, number> = {
  '고정결석계': 1,
  '일반결석계': 2,
  '결석': 2,
  '지각': 0.5,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const results: Record<string, number> = {};

    for (const sheetName of SHEET_NAMES) {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:G`,
      });
    
      const rows = data.values || [];
      let total = 0;
      let lateCount = 0;
    
      for (const row of rows) {
        const 이름셀 = row[1]; // B열
        const 출결셀 = row[3]; // D열
    
        if (이름셀 === name) {
          if (출결셀 === '지각') lateCount += 1;
          else if (RULES[출결셀]) total += RULES[출결셀];
        }
      }
    
      total += Math.floor(lateCount / 2) * 2;
    
      if (total > 0) {
        results[sheetName] = total;
      }
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
