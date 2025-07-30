// app/api/upload/route.ts - 서비스 계정 방식 + 폴더 생성 로직 포함
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

export async function POST(req: NextRequest) {
  try {
    const { piece } = await req.json();
    if (!piece || typeof piece !== 'string') {
      return NextResponse.json({ error: 'piece is required' }, { status: 400 });
    }

    // 🔐 서비스 계정 인증 (원본과 동일한 scope 사용)
    const auth = new google.auth.GoogleAuth({
      projectId : 'ensemble-submission',
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive',
               'https://www.googleapis.com/auth/drive.file'
      ],  // ← 원본과 동일하게 단순화
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // 1️⃣ 곡 폴더 검색
    const { data } = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    let folderId = data.files?.[0]?.id;
    let folderName = data.files?.[0]?.name;

    // 2️⃣ 폴더가 없으면 생성 (원본 로직 복원)
    if (!folderId) {
      const folderCreate = await drive.files.create({
        requestBody: {
          name: piece,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [PARENT_FOLDER_ID],
        },
        fields: 'id, name',
      });
      folderId = folderCreate.data.id!;
      folderName = folderCreate.data.name!;
    }

    // 3️⃣ 액세스 토큰 생성
    const accessToken = await auth.getAccessToken();
    
    if (!accessToken) {
      throw new Error('액세스 토큰을 가져올 수 없습니다.');
    }

    return NextResponse.json({ 
      access_token: accessToken, 
      folderId: folderId,
      folderName: folderName
    });

  } catch (err: any) {
    console.error('Upload token error:', err);
    return NextResponse.json(
      { error: `토큰 생성 실패: ${err.message}` }, 
      { status: 500 }
    );
  }
}