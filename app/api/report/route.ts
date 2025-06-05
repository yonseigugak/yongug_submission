// =============================================
// app/api/report/route.ts   (NEW)
// =============================================
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

const SHEET_ID       = process.env.GOOGLE_SHEETS_SHEET_ID!;
const SHEET_NAMES    = ['취타', '미락흘', '도드리', '축제', '플투스'] as const;
const FOLDER_IDS     = JSON.parse(process.env.GOOGLE_DRIVE_FOLDER_IDS!);

// 출결  → 음원 요구량
const AUDIO_RULE = {
  고정결석계 : 1,
  일반결석계 : 2,
  결석       : 2,
  지각       : 0,   // 지각은 나중에 짝수 계산
};
// 결석 1회당 즉시 부과되는 벌금
const ABSENT_FINE = 3_000;
// 음원 1개 미제출당 벌금
const AUDIO_FINE  = 3_000;

type Counts = { 고정결석계: number; 일반결석계: number; 결석: number; 지각: number };

export async function GET(_req: NextRequest) {
  try {
    /* ─────────────────── Google 인증 ─────────────────── */
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL!,
        private_key : process.env.GOOGLE_SHEETS_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const drive  = google.drive({ version: 'v3', auth });

    /* ───────────── 1) 전 인원의 출결 집계 ───────────── */
    const byName: Record<string, Counts> = {};

    for (const sheetName of SHEET_NAMES) {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:H`,
      });
      for (const row of data.values ?? []) {
        const name  = (row[1] ?? '').trim();   // B열
        const label = row[4] as keyof Counts;  // E열
        if (!name || !byName[name]) {
          byName[name] = { 고정결석계: 0, 일반결석계: 0, 결석: 0, 지각: 0 };
        }
        if (label && label in byName[name]) {
          byName[name][label] += 1;
        }
      }
    }

    /* ───────────── 2) 전 인원의 업로드 집계 ───────────── */
    const uploaded: Record<string, number> = {};

    for (const [piece, folderId] of Object.entries(FOLDER_IDS) as [string, string][]) {
      let pageToken: string | undefined;
      do {
        const { data } = await drive.files.list({
          q          : `'${folderId}' in parents and trashed = false`,
          fields     : 'nextPageToken, files(name)',
          pageToken,
        });
        for (const file of data.files ?? []) {
          //  업로드 파일명 예: "홍길동_취타_1717315932156.mp3"
          const [uName] = file.name?.split('_') ?? [];
          if (uName) uploaded[uName] = (uploaded[uName] ?? 0) + 1;
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    /* ─────── 3) 필요·미제출·벌금 계산 및 행 데이터 구성 ─────── */
    const rows: any[][] = [
      ['이름', '고정결석계', '일반결석계', '결석', '지각',
       '필요 음원', '제출', '미제출', '벌금(원)'],
    ];

    for (const [name, c] of Object.entries(byName)) {
      const latePairs   = Math.floor(c.지각 / 2) * 2;                 // 2회마다 2개
      const requiredAud = (
        c.고정결석계 * AUDIO_RULE.고정결석계 +
        c.일반결석계 * AUDIO_RULE.일반결석계 +
        c.결석       * AUDIO_RULE.결석       +
        latePairs
      );
      const submitted   = uploaded[name] ?? 0;
      const missingAud  = Math.max(requiredAud - submitted, 0);

      const fine = c.결석 * ABSENT_FINE + missingAud * AUDIO_FINE;

      rows.push([
        name, c.고정결석계, c.일반결석계, c.결석, c.지각,
        requiredAud, submitted, missingAud, fine,
      ]);
    }

    /* ───────────── 4) “벌금 정산” 시트 갱신 ───────────── */
    const REPORT_SHEET_TITLE = '벌금_정산';

    // 시트 ID 탐색 (있으면 덮어쓰기, 없으면 새로 만들기)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    let reportSheetId =
      meta.data.sheets?.find(s => s.properties?.title === REPORT_SHEET_TITLE)
        ?.properties?.sheetId;

    if (!reportSheetId) {
      const { data } = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody  : {
          requests: [{ addSheet: { properties: { title: REPORT_SHEET_TITLE } } }],
        },
      });
      reportSheetId = data.replies?.[0].addSheet?.properties?.sheetId;
    } else {
      // 기존 내용 모두 지우기
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody  : {
          requests: [{
            updateCells: {
              range: { sheetId: reportSheetId },
              fields: 'userEnteredValue',
            },
          }],
        },
      });
    }

    // 값 쓰기
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range        : `${REPORT_SHEET_TITLE}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody  : { values: rows },
    });

    return NextResponse.json({ ok: true, rows: rows.length - 1 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 });
  }
}
