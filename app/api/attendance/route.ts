import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

const SHEET_ID = process.env.GOOGLE_SHEETS_SHEET_ID!;

const SHEET_NAMES = ['도드리', '타령', '축연무', '메나리'];

const RULES: Record<string, number> = {
  '고정지각계': 1,
  '일반결석계': 2,
  '지각': 2,
  '결석': 3,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name')?.trim();

  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: process.env.REFRESH_TOKEN
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const results: Record<
      string,
      { required: number; breakdown: Record<string, number> }
    > = {};

    for (const sheetName of SHEET_NAMES) {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:H`,
      });

      const rows = data.values ?? [];

      const cnt: Record<string, number> = {
        '고정지각계': 0,
        '일반결석계': 0,
        '지각': 0,
        '결석': 0,
      };

      for (const row of rows) {
        const 이름 = row[1]?.toString().trim();
        const 출결 = row[4]?.toString().trim();

        if (이름 === name && 출결 && cnt.hasOwnProperty(출결)) {
          cnt[출결] += 1;
        }
      }

      const requiredSum =
        cnt['고정지각계'] * RULES['고정지각계'] +
        cnt['일반결석계'] * RULES['일반결석계'] +
        cnt['지각'] * RULES['지각'] +
        cnt['결석'] * RULES['결석'];

      if (requiredSum > 0) {
        results[sheetName] = {
          required: requiredSum,
          breakdown: cnt,
        };
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error('attendance route error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}