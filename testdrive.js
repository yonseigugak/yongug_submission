// test-drive.js
import { google } from 'googleapis';
import 'dotenv/config'; // dotenv 설치 필요 (npm install dotenv)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });


const auth = new google.auth.GoogleAuth({
  projectId: 'ensemble-submission',
  credentials: {
    client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function test() {
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client });

  const res = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID}' in parents`,
    fields: 'files(id, name)',
  });

  console.log(res.data.files);
}

test().catch(console.error);
