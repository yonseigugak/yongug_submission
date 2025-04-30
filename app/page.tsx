// =============================
// app/page.tsx  (클라이언트 UI)
// =============================
'use client';

import { useState } from 'react';

export default function Home() {
  const [name, setName] = useState('');
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPiece, setSelectedPiece] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  const pieces = ['취타', '미락흘', '도드리', '축제', '플투스'];

  /** 출결(제출 개수) 조회 */
  const fetchAttendance = async () => {
    if (!name.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`/api/attendance?name=${encodeURIComponent(name)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '조회 실패');
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  /** Google Drive Resumable Upload */
  const handleUpload = async () => {
    if (!file || !selectedPiece || !name.trim()) {
      setUploadMessage('이름, 곡명, 파일을 모두 선택해주세요.');
      return;
    }

    try {
      setUploadMessage('토큰 요청 중...');
      setProgress(null);

      /** 1️⃣ 토큰 + 폴더 ID 요청 (몇 KB 이내) */
      const tokenRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece: selectedPiece }),
      });
      const { access_token, folderId, error } = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(error || '토큰 요청 실패');

      /** 2️⃣ Resumable 세션 시작 */
      setUploadMessage('세션 생성 중...');
      const sessionRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `${name}_${selectedPiece}_${Date.now()}.mp3`,
            parents: [folderId],
          }),
        },
      );

      const uploadUrl = sessionRes.headers.get('location');
      if (!uploadUrl) throw new Error('Resumable 세션 URL 획득 실패');

      /** 3️⃣ 실제 파일 업로드 (수십 MB OK) */
      setUploadMessage('업로드 중...');

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.statusText)));
        xhr.onerror = () => reject(new Error('XHR 오류'));
        xhr.send(file);
      });

      setUploadMessage('✅ 업로드 성공!');
      setFile(null);
      setSelectedPiece('');
    } catch (err: any) {
      setUploadMessage(`❌ 업로드 실패: ${err.message}`);
    }
  };

  return (
    <main className="p-8 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">합주 음원 제출 시스템 🎶</h1>

      {/* 이름 입력 & 조회 버튼 */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="이름을 입력하세요"
        className="border p-2 w-full rounded"
      />
      <button
        onClick={fetchAttendance}
        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        disabled={loading}
      >
        {loading ? '조회 중...' : '제출 개수 확인'}
      </button>

      {/* 조회 결과 / 오류 표시 */}
      {error && <p className="text-red-500">{error}</p>}
      {result && (
        <div>
          <h2 className="text-xl font-semibold mt-4 mb-2">제출해야 할 곡 수 🎵</h2>
          <ul className="list-disc pl-6">
            {Object.entries(result).map(([곡명, 개수]) => (
              <li key={곡명}>
                <strong>{곡명}</strong>: {개수}개
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 업로드 UI */}
      <div className="border-t pt-4">
        <h2 className="text-xl font-semibold mb-2">음원 업로드</h2>

        <select
          value={selectedPiece}
          onChange={(e) => setSelectedPiece(e.target.value)}
          className="border p-2 w-full mb-2 rounded"
        >
          <option value="">곡 선택</option>
          {pieces.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="mb-2"
        />

        <button
          onClick={handleUpload}
          className="bg-green-600 text-white px-4 py-2 rounded"
        >
          업로드
        </button>

        {uploadMessage && <p className="mt-2 text-sm">{uploadMessage}</p>}
        {progress !== null && <p className="text-sm text-gray-600">{progress}%</p>}
      </div>
    </main>
  );
}