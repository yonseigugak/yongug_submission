// app/api/upload/route.ts
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

export async function POST(req: NextRequest) {
  try {
    const { piece } = await req.json();
    if (!piece) {
      return NextResponse.json({ error: 'piece is required' }, { status: 400 });
    }

    /* 1) 서비스 계정 토큰 */
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key : process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const access_token = await auth.getAccessToken();
    const drive = google.drive({ version: 'v3', auth });

    /* 2) 곡 폴더 검색 ― (없으면 에러) */
    const { data } = await drive.files.list({
      q : `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
      supportsAllDrives: true,            // ★ 중요
      includeItemsFromAllDrives: true,    // ★
    });

    const folderId = data.files?.[0]?.id;
    if (!folderId) {
      return NextResponse.json(
        { error: `곡 폴더 '${piece}'를 찾을 수 없습니다. 관리자에게 폴더를 만들어 달라고 요청하세요.` },
        { status: 400 },
      );
    }

    return NextResponse.json({ access_token, folderId });
  } catch (err) {
    console.error('upload token-provider error:', err);
    return NextResponse.json({ error: 'Failed to generate Drive token' }, { status: 500 });
  }
}
