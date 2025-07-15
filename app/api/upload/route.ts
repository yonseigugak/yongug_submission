// app/api/upload/route.ts - OAuth 2.0 방식
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

    // OAuth 2.0 클라이언트 설정
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!
    );

    // 저장된 토큰 사용 (실제로는 데이터베이스에서 가져와야 함)
    oauth2Client.setCredentials({
      access_token: process.env.GOOGLE_ACCESS_TOKEN!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
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

    // 액세스 토큰 갱신 및 반환
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    return NextResponse.json({ 
      access_token: credentials.access_token, 
      folderId: folder.id,
      folderName: folder.name 
    });

  } catch (err: any) {
    console.error('OAuth upload error:', err);
    return NextResponse.json(
      { error: `토큰 생성 실패: ${err.message}` }, 
      { status: 500 }
    );
  }
}