// =============================================
// app/api/upload/route.ts  (Token Provider 완성본)
// =============================================
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

/**
 * 이 라우트는 대용량 파일을 직접 받지 않고
 * 1) 1‑hour Google Drive access_token 발급
 * 2) 요청된 곡(piece) 폴더가 없으면 생성 후 folderId 반환
 */
export async function POST(req: NextRequest) {
  try {
    const { piece } = await req.json();
    if (!piece || typeof piece !== 'string') {
      return NextResponse.json({ error: 'piece is required' }, { status: 400 });
    }

    // 🔐 서비스 계정 인증
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    // 1️⃣  Access Token (약 1시간 유효)
    const access_token = await auth.getAccessToken();

    // 2️⃣  곡 폴더 검색/생성
    const drive = google.drive({ version: 'v3', auth });

    const list = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    });

    let folderId = list.data.files?.[0]?.id;

    if (!folderId) {
      const folderCreate = await drive.files.create({
        requestBody: {
          name: piece,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [PARENT_FOLDER_ID],
        },
        fields: 'id',
      });
      folderId = folderCreate.data.id!;
    }

    return NextResponse.json({ access_token, folderId });
  } catch (error) {
    console.error('upload token-provider error:', error);
    return NextResponse.json({ error: 'Failed to generate Drive token' }, { status: 500 });
  }
}