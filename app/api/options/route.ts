import { google } from 'googleapis';
import { NextRequest } from 'next/server';

export async function GET(_req: NextRequest) {
  try {
    /* 1) 구글 인증 */
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

    /* 2) CONFIG 탭 A열 = 곡명이라고 가정 */
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CONFIG!A:A',
    });
    const songs =
      (data.values ?? []).slice(1).map(r => r[0]).filter(Boolean) as string[];

    return Response.json({ songs });
  } catch (e) {
    console.error(e);
    return Response.json({ error: '곡 목록 로딩 실패' }, { status: 500 });
  }
}
