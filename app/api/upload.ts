// File: pages/api/upload.ts

import { google } from 'googleapis';
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File } from 'formidable';
import fs from 'fs';
import { Readable } from 'stream';

export const config = {
  api: {
    bodyParser: false,
  },
};

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parsing error:', err);
      return res.status(400).json({ error: 'Form parsing failed' });
    }

    const name = Array.isArray(fields.name) ? fields.name[0] : fields.name;
    const piece = Array.isArray(fields.piece) ? fields.piece[0] : fields.piece;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!name || !piece || !file) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    try {
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

      const fileStream = fs.createReadStream(file.filepath);

      const uploaded = await drive.files.create({
        requestBody: {
          name: `${name}_${piece}_${Date.now()}.mp3`,
          parents: [folderId],
        },
        media: {
          mimeType: file.mimetype || 'audio/mpeg',
          body: fileStream,
        },
        fields: 'id, name, webViewLink',
      });

      return res.status(200).json({ message: '업로드 성공', file: uploaded.data });
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'Google Drive 업로드 실패' });
    }
  });
}