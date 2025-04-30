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

  const pieces = ['취타', '미락흘', '도드리', '축제', '플투스'];

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

  const handleUpload = async () => {
    if (!file || !selectedPiece || !name.trim()) {
      setUploadMessage('이름, 곡명, 파일을 모두 선택해주세요.');
      return;
    }
  
    const formData = new FormData();
    formData.append('name', name);
    formData.append('piece', selectedPiece);
    formData.append('file', file);
  
    setUploadMessage('업로드 중...');
  
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
  
      let message = '업로드 실패';
      try {
        const data = await res.json();
        message = data.message || data.error || message;
      } catch (e) {
        const text = await res.text(); // ⚠️ JSON 아님 → 텍스트로 fallback
        message = `❌ 서버 응답 오류: ${text.slice(0, 100)}`;
      }
  
      if (!res.ok) throw new Error(message);
  
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

        {uploadMessage && (
          <p className="mt-2 text-sm">{uploadMessage}</p>
        )}
      </div>
    </main>
  );
}
