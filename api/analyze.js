import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = { api: { bodyParser: false } };

const SYSTEM_PROMPT = `あなたはプロのゴルフコーチです。アップロードされたゴルフスイングの画像を分析し、日本語で具体的なアドバイスを提供してください。

画像が逆光・不鮮明・一部しか見えない場合でも、見えている情報を最大限活用して必ず全項目を回答してください。

分析項目（全て必ず回答）：
1. アドレス（構え）: グリップ、スタンス幅、ボール位置、姿勢
2. バックスイング: テイクバック、肩の回転、腕の動き
3. トップ: クラブの位置、左腕の伸び、体の捻転
4. ダウンスイング〜インパクト: 切り返し、体重移動、フェース角度
5. フォロースルー: 腕の伸び、フィニッシュの形

出力形式（必ずこの形式で全て出力）：
## 総合評価
★★★★☆ （理由を1文で）

## 良い点
- 良い点1
- 良い点2
- 良い点3

## 改善ポイント
1. 【最優先】改善点の説明
   📌 練習ドリル: 具体的な練習方法
   2. 【次に重要】改善点の説明
      📌 練習ドリル: 具体的な練習方法
      3. 改善点の説明
         📌 練習ドリル: 具体的な練習方法

         ## コーチからひと言
         励ましのメッセージ`;

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
                                                             const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

                                                                   const response = await fetch(url, {
                                                                           method: 'POST',
                                                                                   headers: { 'Content-Type': 'application/json' },
                                                                                           body: JSON.stringify({
                                                                                                     contents: [{
                                                                                                                 parts: [
                                                                                                                               { text: SYSTEM_PROMPT },
                                                                                                                                             { inline_data: { mime_type: mimeType, data: base64 } }
                                                                                                                                                         ]
                                                                                                                                                                   }],
                                                                                                                                                                             generationConfig: { maxOutputTokens: 2000, temperature: 0.4 }
                                                                                                                                                                                     })
                                                                                                                                                                                           });

                                                                                                                                                                                                 const data = await response.json();
                                                                                                                                                                                                       if (!response.ok) throw new Error(data.error?.message || '解析に失敗しました');

                                                                                                                                                                                                             const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '解析結果を取得できませんでした';
                                                                                                                                                                                                                   res.json({ result: text });
                                                                                                                                                                                                                       } catch (e) {
                                                                                                                                                                                                                             console.error(e);
                                                                                                                                                                                                                                   res.status(500).json({ error: e.message });
                                                                                                                                                                                                                                       }
                                                                                                                                                                                                                                         });
                                                                                                                                                                                                                                         }
                                                                                                                                                                                                                                         