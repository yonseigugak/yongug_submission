// ensemble-submission/lib/getSheetNames.ts
import { google } from 'googleapis';

let cached: string[] | null = null;
let cachedAt = 0;
const TTL = 5 * 60 * 1000;          // 5분 캐시

export async function getSheetNames(): Promise<string[]> {
  if (cached && Date.now() - cachedAt < TTL) return cached;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key:  process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  /* 방법 A) CONFIG!A:A 헤더 제외 ------------ */
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'CONFIG!A:A',
  });
  const names =
    (data.values ?? []).slice(1).map(r => r[0]).filter(Boolean) as string[];

  /* 방법 B) 시트 탭 제목을 곡명으로 쓰려면: */
  // const meta = await sheets.spreadsheets.get({ spreadsheetId, fields:'sheets.properties' });
  // const names = meta.data.sheets?.map(s => s.properties?.title!).filter(Boolean) ?? [];

  cached   = names;
  cachedAt = Date.now();
  return names;
}
