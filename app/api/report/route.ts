// =============================================
// app/api/report/route.ts
// =============================================
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { getSheetNames } from '@/lib/getSheetNames'; 

// Vercel 기본 Edge Runtime 대신 Node 런타임이 필요
export const runtime = 'nodejs';

/* ───── 환경 변수 ───── */
const SECRET = process.env.REPORT_SECRET;
const SHEET_ID = process.env.GOOGLE_SHEETS_SHEET_ID!;
const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

// 서비스 계정 키는 두 가지 이름 중 하나만 있어도 동작하게
const CLIENT_EMAIL =
  process.env.GOOGLE_CLIENT_EMAIL ?? process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
const PRIVATE_KEY  =
  process.env.GOOGLE_PRIVATE_KEY  ?? process.env.GOOGLE_SHEETS_PRIVATE_KEY;

/* ───── 단가 상수 ───── */
const ABSENT_FINE = 3_000;  // 결석 1회당
const AUDIO_FINE  = 3_000;  // 미제출 음원 1개당

/* ───── 타입 ───── */
type Counts = { 고정결석계: number; 일반결석계: number; 결석: number; 지각: number };

export async function GET(req: NextRequest) {

  const key =
    req.headers.get('x-report-secret') ??
    req.nextUrl.searchParams.get('key');
  if (!SECRET || key !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sheetNames = await getSheetNames();
  try {
    if (!CLIENT_EMAIL || !PRIVATE_KEY) {
      throw new Error('Google 서비스 계정 환경변수가 없습니다.');
    }

    /* ───────── Google 인증 ───────── */
    const auth = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: process.env.REFRESH_TOKEN
    });

    const sheets  = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth});

    /* ───────── 1) 출결 "곡별" 집계 ───────── */
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
        const name  = (row[1] ?? '').trim();         // B열
        const label = row[4] as keyof Counts;        // E열
        if (!name) continue;

        // 이름·곡 초기화
        if (!byNamePiece[name])            byNamePiece[name] = {} as any;
        if (!byNamePiece[name][sheetName]) byNamePiece[name][sheetName] =
          { 고정결석계: 0, 일반결석계: 0, 결석: 0, 지각: 0 };

        if (label && label in byNamePiece[name][sheetName]) {
          byNamePiece[name][sheetName][label] += 1;
        }
      }
    }

    /* ───────── 2) 업로드 집계 (동적 폴더 검색 방식으로 변경) ───────── */
    const uploaded: Record<string, number> = {};

    // 각 곡별로 폴더를 동적으로 찾아서 파일 집계
    for (const piece of sheetNames) {
      // 곡 폴더 찾기
      const { data: folderList } = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
        pageSize: 1,
      });

      const folderId = folderList.files?.[0]?.id;
      if (!folderId) continue;

      // 해당 폴더의 모든 파일 조회
      let pageToken: string | undefined;
      do {
        const { data } = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false and mimeType!='application/vnd.google-apps.folder'`,
          fields: 'nextPageToken, files(name)',
          pageToken,
        });
        for (const file of data.files ?? []) {
          const [uName] = file.name?.split('_') ?? [];
          if (uName) uploaded[uName] = (uploaded[uName] ?? 0) + 1;
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    /* ───────── 3) 벌금·음원 계산 ───────── */
    const rows: any[][] = [
      ['이름', '고정결석계', '일반결석계', '결석', '지각',
       '필요 음원', '제출', '미제출', '벌금(원)'],
    ];

    for (const [name, pieceMap] of Object.entries(byNamePiece)) {
      const sumCnt: Counts = { 고정결석계: 0, 일반결석계: 0, 결석: 0, 지각: 0 };
      let requiredAud = 0;

      for (const cnt of Object.values(pieceMap)) {
        (Object.keys(cnt) as (keyof Counts)[]).forEach(
          k => (sumCnt[k] += cnt[k]),
        );

        // 지각: ⌊n/2⌋×2 개
        const lateAud = Math.floor(cnt.지각 / 2) * 2;

        requiredAud +=
          cnt.고정결석계 * 1 +
          cnt.일반결석계 * 2 +
          cnt.결석       * 2 +
          lateAud;
      }

      const submitted   = uploaded[name] ?? 0;
      const missingAud  = Math.max(requiredAud - submitted, 0);
      const fine        = sumCnt.결석 * ABSENT_FINE +
                          missingAud   * AUDIO_FINE;

      rows.push([
        name,
        sumCnt.고정결석계, sumCnt.일반결석계, sumCnt.결석, sumCnt.지각,
        requiredAud, submitted, missingAud, fine,
      ]);
    }

    /* ───────── 4) "벌금_정산" 시트 덮어쓰기 ───────── */
    const REPORT_TITLE = '벌금_정산';
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });

    let reportSheetId =
      meta.data.sheets?.find(s => s.properties?.title === REPORT_TITLE)
        ?.properties?.sheetId;

    if (!reportSheetId) {
      const { data } = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody : {
          requests: [{ addSheet: { properties: { title: REPORT_TITLE } } }],
        },
      });
      reportSheetId = data.replies?.[0].addSheet?.properties?.sheetId;
    } else {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody : {
          requests: [{
            updateCells: {
              range : { sheetId: reportSheetId },
              fields: 'userEnteredValue',
            },
          }],
        },
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId   : SHEET_ID,
      range           : `${REPORT_TITLE}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody     : { values: rows },
    });

    return NextResponse.json({ ok: true, rows: rows.length - 1 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message ?? 'Server error' },
      { status: 500 },
    );
  }
}