// File: app/api/upload/route.ts

import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const name = formData.get('name') as string;
    const piece = formData.get('piece') as string;
    const file = formData.get('file') as File;

    if (!name || !piece || !file) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stream = Readable.from(buffer);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    const folderList = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${piece}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)',
    });

    let folderId = folderList.data.files?.[0]?.id;

    if (!folderId) {
      const folder = await drive.files.create({
        requestBody: {
          name: piece,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [PARENT_FOLDER_ID],
        },
        fields: 'id',
      });
      folderId = folder.data.id!;
    }

    const uploaded = await drive.files.create({
      requestBody: {
        name: `${name}_${piece}_${Date.now()}.mp3`,
        parents: [folderId],
      },
      media: {
        mimeType: file.type,
        body: stream,
      },
      fields: 'id, name, webViewLink',
    });

    return NextResponse.json({ message: '업로드 성공', file: uploaded.data });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Google Drive 업로드 실패' }, { status: 500 });
  }
}
