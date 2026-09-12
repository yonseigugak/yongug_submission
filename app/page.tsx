// =============================
// app/page.tsx  (클라이언트 UI ‑ 전체 소스)
// =============================
'use client';

import { useState, useEffect } from 'react';

/** 항목 축약 라벨 */
const LABEL: Record<string, string> = {
  고정결석계: '고정',
  일반결석계: '일반',
  무단결석:       '무단',
  지각:       '지각',
  //고정지각: '별도처리',
};

/** 스프레드시트에 존재하는 곡명 시트 */
//const PIECES = ['취타', '미락흘', '도드리', '축제', '플투스'] as const;

type Breakdown = Record<'고정결석계' | '일반결석계' | '결석' | '지각', number>;
type SheetInfo = { required: number; breakdown: Breakdown };

type SheetInfoWithUpload = SheetInfo & { submitted: number };


export default function Home() {
  // -------------------- 상태 --------------------
  const [pieces,          setPieces]       = useState<string[]>([]);
  const [name,            setName]         = useState('');
  const [result,          setResult]       = useState<Record<string, SheetInfoWithUpload> | null>(null);
  const [loading,         setLoading]      = useState(false);
  const [error,           setError]        = useState('');

  const [uploading,       setUploading]    = useState(false);
  const [secret,          setSecret]       = useState('');

  // 업로드용
  const [selectedPiece,   setSelectedPiece] = useState('');
  const [file,            setFile]          = useState<File | null>(null);
  const [uploadMessage,   setUploadMessage] = useState('');
  const [progress,        setProgress]      = useState<number | null>(null);

  /* ② ── 옵션 fetch(useEffect) ── */
  useEffect(() => {
    (async () => {
      try {
        const res   = await fetch('/api/options');        // { songs, timeSlots }
        const { songs } = (await res.json()) as { songs: string[] };
        setPieces(songs);                                 // <-- 곡 목록 저장
      } catch (err) {
        console.error(err);
        alert('곡 목록을 불러오지 못했습니다.');
      }
    })();
  }, []);   // <- 컴포넌트 최초 마운트 때 한 번 실행

  /* ⑴ 벌금 정산 실행 함수 */
  const runReport = async () => {
    const key = secret || window.prompt('관리자 비밀번호') || '';
    if (!key) return;

    try {
      const res = await fetch('/api/report', {
        headers: { 'x-report-secret': key },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`✅ 완료! ${data.rows}명 반영`);
      setSecret(key);                       // 세션 동안 재사용
    } catch (e: any) {
      alert(`❌ 실패: ${e.message}`);
    }
  };

  // -------------------- 함수: 출결 + 업로드 현황 조회 --------------------
  const fetchAttendance = async () => {
    if (!name.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
    // ✅ 출결(스프레드시트) + 업로드(Drive) 두 API를 병렬 호출
      const [attRes, subRes] = await Promise.all([
        fetch(`/api/attendance?name=${encodeURIComponent(name)}`),
        fetch(`/api/submissions?name=${encodeURIComponent(name)}`),
      ]);

      const [attData, subData] = await Promise.all([attRes.json(), subRes.json()]);
      if (!attRes.ok) throw new Error(attData.error || '출결 조회 실패');
      if (!subRes.ok) throw new Error(subData.error || '업로드 조회 실패');

      /* attData: { [piece]: { required, breakdown } }
        subData: { [piece]: number } */
      const merged: Record<string, SheetInfoWithUpload> = Object.fromEntries(
        Object.entries(attData as Record<string, SheetInfo>).map(
          ([piece, info]) => [
            piece,
          { ...info, submitted: subData[piece] ?? 0 },
        ]),
      );
      setResult(merged);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // -------------------- 함수: Google Drive Resumable Upload --------------------
// app/page.tsx의 handleUpload 함수 개선판
const handleUpload = async () => {
  if (uploading) return;
  if (!file || !selectedPiece || !name.trim()) {
    setUploadMessage('이름, 곡명, 파일을 모두 선택해주세요.');
    return;
  }

  try {
    setUploading(true);
    setUploadMessage('토큰 요청 중...');
    setProgress(null);

    // 1️⃣ 토큰 + 폴더 ID 요청
    const tokenRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece: selectedPiece }),
    });
    const { access_token, folderId, error } = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(error || '토큰 요청 실패');

    // 2️⃣ Resumable 세션 시작
    setUploadMessage('세션 생성 중...');
    const fileName = `${name}_${selectedPiece}_${Date.now()}.mp3`;
    
    const sessionRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': file.type || 'audio/mpeg',
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify({
          name: fileName,
          parents: [folderId],
        }),
      },
    );

    if (!sessionRes.ok) {
      const errorText = await sessionRes.text();
      console.error('Session creation failed:', errorText);
      throw new Error(`세션 생성 실패: ${sessionRes.status} ${sessionRes.statusText}`);
    }

    const uploadUrl = sessionRes.headers.get('location');
    if (!uploadUrl) throw new Error('Resumable 세션 URL 획득 실패');

    // 3️⃣ 실제 파일 업로드 (개선된 버전)
    setUploadMessage('업로드 중...');

    const uploadResult = await new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg');
      
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          setProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };
      
      xhr.onload = () => {
        console.log('Upload response:', {
          status: xhr.status,
          statusText: xhr.statusText,
          responseText: xhr.responseText
        });
        
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            resolve(result);
          } catch (e) {
            // 응답이 JSON이 아닐 수도 있음
            resolve({ success: true });
          }
        } else {
          let errorDetail = xhr.responseText;
          try {
            const errorObj = JSON.parse(xhr.responseText);
            errorDetail = errorObj.error?.message || errorObj.message || xhr.responseText;
          } catch {}
          
          reject(new Error(`업로드 실패: ${xhr.status} ${xhr.statusText} - ${errorDetail}`));
        }
      };
      
      xhr.onerror = () => reject(new Error('네트워크 오류'));
      xhr.ontimeout = () => reject(new Error('업로드 타임아웃'));
      xhr.timeout = 300000; // 5분 타임아웃
      
      xhr.send(file);
    });

    console.log('Upload successful:', uploadResult);
    setUploadMessage('✅ 업로드 성공!');
    setFile(null);
    setSelectedPiece('');
    setProgress(null);
    
    // 업로드 후 출결 현황 새로고침
    if (name.trim()) {
      await fetchAttendance();
    }
    
  } catch (err: any) {
    console.error('Upload error:', err);
    setUploadMessage(`❌ 업로드 실패: ${err.message}`);
    setProgress(null);
  } finally {
    setUploading(false);
  }
};

  // -------------------- UI --------------------
  return (
    <main className="p-8 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">합주 음원 제출 시스템 🎶</h1>

      {/* 이름 입력 & 조회 버튼 */}
      {error && <p className="mt-2 text-red-500">{error}</p>}
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
      {result && (
        <div>
          <h2 className="text-xl font-semibold mt-4 mb-2">
            제출 현황&nbsp;🎵
          </h2>

          <ul className="list-disc pl-6 space-y-1">
            {Object.entries(result).map(
              // 🔹 submitted까지 구조 분해
              ([piece, { required, submitted, breakdown }]) => {
                const detail = Object.entries(breakdown)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${LABEL[k]} ${v}`)
                  .join(', ');

                // 남은 개수(필요-제출)가 0이면 초록, 그 외 빨강
                const remaining = required - submitted;
                const remainColor =
                  remaining === 0 ? 'text-green-600' : 'text-red-600';

                return (
                  <li key={piece}>
                    <strong>{piece}</strong> :&nbsp;
                    <span className={remainColor}>
                      남은 {remaining}개&nbsp;
                    </span>
                    (필요 {required} / 제출 {submitted})&nbsp;
                    <span className="text-gray-600">({detail})</span>
                  </li>
                );
              },
            )}
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
          disabled={pieces.length ===0 }
        >
          <option value="">곡 선택</option>
          {pieces.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <input
          type="file"
          /* accept="audio/*" */
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="
            mb-2
            file:bg-blue-600 file:text-white
            file:px-4 file:py-2 file:rounded
            file:border-0
            file:cursor-pointer
            hover:file:bg-blue-700
          "
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
        {/* ───────── 관리자 전용: 벌금 정산 ───────── */}
      <div className="border-t pt-6">
        <h2 className="text-lg font-semibold mb-3">관리자 기능</h2>
        <button
          onClick={runReport}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded"
        >
          벌금 정산 시트 생성 / 갱신
        </button>
      </div>
    </main>
  );
}
