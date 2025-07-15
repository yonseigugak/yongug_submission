// app/api/upload/route.ts - 서비스 계정 방식으로 변경
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

    // 서비스 계정 방식으로 변경 (다른 API 파일들과 동일하게)
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive'
      ],
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // 곡 폴더 검색
    const { data } = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)',
    });

    const folder = data.files?.[0];
    if (!folder || !folder.id) {
      return NextResponse.json(
        { error: `곡 폴더 '${piece}'를 찾을 수 없습니다.` },
        { status: 404 }
      );
    }

    // 서비스 계정 액세스 토큰 생성
    const accessToken = await auth.getAccessToken();
    
    if (!accessToken) {
      throw new Error('액세스 토큰을 가져올 수 없습니다.');
    }

    return NextResponse.json({ 
      access_token: accessToken, 
      folderId: folder.id,
      folderName: folder.name 
    });

  } catch (err: any) {
    console.error('Upload token error:', err);
    return NextResponse.json(
      { error: `토큰 생성 실패: ${err.message}` }, 
      { status: 500 }
    );
  }
}