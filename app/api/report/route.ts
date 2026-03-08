// =============================================
// app/api/report/route.ts
// =============================================
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { getSheetNames } from '@/lib/getSheetNames'; 

export const runtime = 'nodejs';

/* ───── 환경 변수 ───── */
const SECRET = process.env.REPORT_SECRET;
const SHEET_ID = process.env.GOOGLE_SHEETS_SHEET_ID!;
const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

/* ───── 단가 상수 ───── */
const ABSENT_FINE = 0;
const AUDIO_FINE  = 2500;

/* ───── 음원 제출 규칙 ───── */
const RULES = {
  고정지각계: 1,
  일반결석계: 2,
  지각: 2,
  결석: 3,
};

type Counts = {
  고정지각계: number;
  일반결석계: number;
  지각: number;
  결석: number;
};

export async function GET(req: NextRequest) {

  const key =
    req.headers.get('x-report-secret') ??
    req.nextUrl.searchParams.get('key');

  if (!SECRET || key !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {

    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      throw new Error('Google OAuth2 환경변수가 없습니다.');
    }

    const sheetNames = await getSheetNames();

    const auth = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: REFRESH_TOKEN
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const drive  = google.drive({ version: 'v3', auth });

    /* ───────── 1) 출결 집계 ───────── */

    const byNamePiece: Record<
      string,
      Record<(typeof sheetNames)[number], Counts>
    > = {};

    for (const sheetName of sheetNames) {

      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:H`,
      });

      for (const row of data.values ?? []) {

        const name  = (row[1] ?? '').trim();
        const label = row[4] as keyof Counts;

        if (!name) continue;

        if (!byNamePiece[name]) byNamePiece[name] = {} as any;

        if (!byNamePiece[name][sheetName]) {
          byNamePiece[name][sheetName] = {
            고정지각계: 0,
            일반결석계: 0,
            지각: 0,
            결석: 0,
          };
        }

        if (label && label in byNamePiece[name][sheetName]) {
          byNamePiece[name][sheetName][label] += 1;
        }
      }
    }

    /* ───────── 2) 업로드 집계 ───────── */

    const uploaded: Record<string, number> = {};
    for (const piece of sheetNames) {

      const { data: folderList } = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
        pageSize: 1,
      });

      const folderId = folderList.files?.[0]?.id;
      if (!folderId) continue;

      let pageToken: string | undefined;

      do {

        const { data } = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
          fields: 'nextPageToken, files(name)',
          pageToken,
        });

        for (const file of data.files ?? []) {

          const [uName] = file.name?.split('_') ?? [];

          if (uName) {
            uploaded[uName] = (uploaded[uName] ?? 0) + 1;
          }
        }

        pageToken = data.nextPageToken ?? undefined;

      } while (pageToken);
    }

    /* ───────── 3) 벌금 계산 ───────── */

    const rows: any[][] = [
      [
        '이름',
        '고정지각계',
        '일반결석계',
        '지각',
        '결석',
        '필요 음원',
        '제출',
        '미제출',
        '벌금(원)',
      ],
    ];

    for (const [name, pieceMap] of Object.entries(byNamePiece)) {

      const sumCnt: Counts = {
        고정지각계: 0,
        일반결석계: 0,
        지각: 0,
        결석: 0,
      };

      let requiredAud = 0;

      for (const cnt of Object.values(pieceMap)) {

        sumCnt.고정지각계 += cnt.고정지각계;
        sumCnt.일반결석계 += cnt.일반결석계;
        sumCnt.지각 += cnt.지각;
        sumCnt.결석 += cnt.결석;

        requiredAud +=
          cnt.고정지각계 * RULES.고정지각계 +
          cnt.일반결석계 * RULES.일반결석계 +
          cnt.지각 * RULES.지각 +
          cnt.결석 * RULES.결석;
      }

      const submitted  = uploaded[name] ?? 0;
      const missingAud = Math.max(requiredAud - submitted, 0);

      const fine =
        sumCnt.결석 * ABSENT_FINE +
        missingAud * AUDIO_FINE;

      rows.push([
        name,
        sumCnt.고정지각계,
        sumCnt.일반결석계,
        sumCnt.지각,
        sumCnt.결석,
        requiredAud,
        submitted,
        missingAud,
        fine,
      ]);
    }

    /* ───────── 4) 시트 업데이트 ───────── */

    const REPORT_TITLE = '벌금_정산';

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID
    });

    let reportSheetId =
      meta.data.sheets
        ?.find(s => s.properties?.title === REPORT_TITLE)
        ?.properties?.sheetId;

    if (!reportSheetId) {

      const { data } = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: REPORT_TITLE }
              }
            }
          ]
        }
      });

      reportSheetId = data.replies?.[0].addSheet?.properties?.sheetId;

    } else {

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              updateCells: {
                range: { sheetId: reportSheetId },
                fields: 'userEnteredValue'
              }
            }
          ]
        }
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${REPORT_TITLE}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    return NextResponse.json({ ok: true, rows: rows.length - 1 });

  } catch (err: any) {

    console.error(err);

    return NextResponse.json(
      { error: err.message ?? 'Server error' },
      { status: 500 }
    );
  }
}