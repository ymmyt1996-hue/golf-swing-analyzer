import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const SYSTEM_PROMPT = `あなたはプロのゴルフコーチです。アップロードされたゴルフスイングの画像を分析し、日本語で具体的なアドバイスを提供してください。

分析項目：
1. アドレス（構え）: グリップ、スタンス幅、ボール位置、姿勢
2. バックスイング: テイクバック、肩の回転、腕の動き
3. トップ: クラブの位置、左腕の伸び、体の捻転
4. ダウンスイング〜インパクト: 切り返し、体重移動、フェース角度
5. フォロースルー: 腕の伸び、フィニッシュの形

出力形式：
- 総合評価（★で5段階）
- 良い点を2〜3つ
- 改善すべき点を優先順位付きで2〜3つ（各改善点に練習ドリルを添える）
- 最後に一言エール

画像が不明瞭でも、見えている範囲で最大限のアドバイスをしてください。`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const form = new IncomingForm({ maxFileSize: 20 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'ファイルの読み込みに失敗しました' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'ファイルが見つかりません' });

    try {
      const imageData = fs.readFileSync(file.filepath);
      const base64 = imageData.toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';

      const apiKey = process.env.GEMINI_API_KEY;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: SYSTEM_PROMPT + '\n\nこのゴルフスイングを詳しく分析して、改善点とアドバイスを教えてください。' },
              { inline_data: { mime_type: mimeType, data: base64 } }
            ]
          }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.4 }
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '解析に失敗しました');

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      res.json({ result: text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
}
