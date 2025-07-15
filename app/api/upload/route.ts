// app/api/upload/route.ts 개선판
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

    // 1) 서비스 계정 인증 (더 구체적인 권한)
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key : process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.metadata.readonly'
      ],
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // 2) 곡 폴더 검색 및 권한 확인
    console.log(`Looking for folder: ${piece} in parent: ${PARENT_FOLDER_ID}`);
    
    const { data } = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name, permissions)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    console.log('Folder search result:', data.files);

    const folder = data.files?.[0];
    if (!folder || !folder.id) {
      return NextResponse.json(
        { error: `곡 폴더 '${piece}'를 찾을 수 없습니다. 관리자에게 폴더를 만들어 달라고 요청하세요.` },
        { status: 404 },
      );
    }

    // 3) 폴더 권한 확인 (선택사항)
    try {
      const permissionCheck = await drive.files.get({
        fileId: folder.id,
        fields: 'permissions',
        supportsAllDrives: true,
      });
      console.log('Folder permissions:', permissionCheck.data.permissions);
    } catch (permError) {
      console.warn('권한 확인 실패 (무시 가능):', permError);
    }

    // 4) 액세스 토큰 생성
    const access_token = await auth.getAccessToken();
    
    if (!access_token) {
      throw new Error('액세스 토큰 생성 실패');
    }

    return NextResponse.json({ 
      access_token, 
      folderId: folder.id,
      folderName: folder.name 
    });

  } catch (err: any) {
    console.error('upload token-provider error:', err);
    return NextResponse.json(
      { 
        error: `토큰 생성 실패: ${err.message}`,
        details: err.stack
      }, 
      { status: 500 }
    );
  }
}