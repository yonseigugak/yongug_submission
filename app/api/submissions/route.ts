// =============================================
// app/api/submissions/route.ts   (NEW)
// 사용법:  GET /api/submissions?name=전승원
// =============================================
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { getSheetNames } from '@/lib/getSheetNames'; 


const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;
//const PIECES = ['취타', '미락흘', '도드리', '축제', '플투스'] as const;

export async function GET(req: NextRequest) {

  const sheetNames = await getSheetNames();

  try {
    const name = new URL(req.url).searchParams.get('name')?.trim();
    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    // 🔐 서비스 계정 인증
    const auth = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: process.env.REFRESH_TOKEN
    });

    const sheets  = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth});
    const counts: Record<string, number> = {};

    // 곡 폴더들을 순회하며 파일 개수 집계
    for (const piece of sheetNames) {
      // ① 곡 전용 폴더 ID 찾기
      const { data: folderList } = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
        pageSize: 1,
      });

      const folderId = folderList.files?.[0]?.id;
      if (!folderId) {
        counts[piece] = 0;
        continue;
      }

      // ② 이름이 포함된(.startsWith는 지원 안 하므로 접두어를 substring 검색) 파일 개수 합산
      let pageToken: string | undefined;
      let fileCount = 0;

      do {
        const { data: fileList } = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and name contains '${name}_'`,
          fields: 'nextPageToken, files(id)',
          spaces: 'drive',
          pageSize: 1000,
          pageToken,
        });
        fileCount += fileList.files?.length ?? 0;
        pageToken = fileList.nextPageToken ?? undefined;
      } while (pageToken);

      counts[piece] = fileCount;
    }

    return NextResponse.json(counts);
  } catch (err) {
    console.error('submissions route error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch submissions' },
      { status: 500 },
    );
  }
}
