import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

const SHEET_ID   = process.env.GOOGLE_SHEETS_SHEET_ID!;
const SHEET_NAMES = ['취타', '미락흘', '도드리', '축제', '플투스'] as const;

const RULES: Record<string, number> = {
  '고정결석계': 1,
  '일반결석계': 2,
  '결석':        2,
  // 지각은 2회당 2개. 따로 계산
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
        private_key : process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets  = google.sheets({ version: 'v4', auth });
    const results: Record<
      (typeof SHEET_NAMES)[number],
      { required: number; breakdown: Record<string, number> }
    > = {} as any;

    for (const sheetName of SHEET_NAMES) {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:G`,
      });

      const rows = data.values ?? [];
      const cnt  = { '고정결석계': 0, '일반결석계': 0, '결석': 0, '지각': 0 };

      for (const row of rows) {
        const 이름   = row[1];   // B열
        const 출결 = row[3];   // D열
        if (이름 === name && cnt.hasOwnProperty(출결)) {
          cnt[출결 as keyof typeof cnt] += 1;
        }
      }

      const latePairs   = Math.floor(cnt['지각'] / 2) * 2;
      const requiredSum =
        cnt['고정결석계'] * RULES['고정결석계'] +
        cnt['일반결석계'] * RULES['일반결석계'] +
        cnt['결석']       * RULES['결석'] +
        latePairs;                       // 지각 기여치

      if (requiredSum > 0) {
        results[sheetName] = {
          required : requiredSum,
          breakdown: cnt,
        };
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
