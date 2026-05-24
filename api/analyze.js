import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = { api: { bodyParser: false } };

const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const WINDOW_MS = 60000;

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - record.start > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (record.count >= RATE_LIMIT) return true;
  record.count++;
  rateLimitMap.set(ip, record);
  return false;
}

const ALLOWED_MIME_TYPES = [
  'image/jpeg','image/png','image/webp','image/gif',
  'video/mp4','video/quicktime','video/webm'
];
const MAX_FILE_SIZE = 15 * 1024 * 1024;

const SYSTEM_PROMPT = `あなたはプロのゴルフコーチです。ゴルフスイングの画像を分析し、以下のJSON形式のみで回答してください。

【重要】逆光・暗い・シルエットのみでも必ず分析してください。見えている輪郭・影・シルエットから体の軸・膝・腕・クラブの位置を推定してください。

画像サイズを1000x1000として、以下の座標を0〜1000の範囲で推定してください。
【座標の注意事項】
- 全ての座標は必ず0〜950の範囲内に収めてください（画面外に出ないように）
- 人物が画像の中央〜右寄りにいる場合、xは400〜700程度になります
- 頭のyは100〜200、足のyは750〜950程度にしてください
- クラブヘッドは必ず画像内（y: 950以下）に収めてください
- 実際の画像をよく見て、人物の位置に合わせた座標を推定してください
- head: 頭の位置
- left_shoulder / right_shoulder: 両肩
- left_hip / right_hip: 両腰
- left_knee / right_knee: 両膝
- left_foot / right_foot: 両足
- left_hand / right_hand: 両手
- club_grip: グリップ位置
- club_head: クラブヘッド位置

以下のJSON形式のみで回答（前後に余分なテキスト不要）：

{
  "score": 75,
  "score_comment": "スコアの理由を1文で",
  "pose": {
    "head": {"x": 500, "y": 100},
    "left_shoulder": {"x": 450, "y": 250},
    "right_shoulder": {"x": 550, "y": 250},
    "left_hip": {"x": 460, "y": 450},
    "right_hip": {"x": 540, "y": 450},
    "left_knee": {"x": 440, "y": 650},
    "right_knee": {"x": 560, "y": 650},
    "left_foot": {"x": 420, "y": 850},
    "right_foot": {"x": 580, "y": 850},
    "left_hand": {"x": 480, "y": 400},
    "right_hand": {"x": 520, "y": 400},
    "club_grip": {"x": 500, "y": 380},
    "club_head": {"x": 300, "y": 700}
  },
  "annotations": [
    {"type": "line", "from": "left_shoulder", "to": "right_shoulder", "color": "#00ff88", "label": "肩のライン"},
    {"type": "line", "from": "left_hip", "to": "right_hip", "color": "#ffaa00", "label": "腰のライン"},
    {"type": "line", "from": "club_grip", "to": "club_head", "color": "#ff4444", "label": "クラブ軌道"},
    {"type": "line", "from": "head", "to": "left_foot", "color": "#4488ff", "label": "体の軸"}
  ],
  "good_points": [
    "良い点1",
    "良い点2",
    "良い点3"
  ],
  "improvements": [
    {
      "priority": 1,
      "title": "改善点タイトル",
      "description": "詳細説明",
      "drill": "練習ドリル",
      "youtube_search": "golf swing drill english keywords"
    },
    {
      "priority": 2,
      "title": "改善点タイトル",
      "description": "詳細説明",
      "drill": "練習ドリル",
      "youtube_search": "golf swing drill english keywords"
    },
    {
      "priority": 3,
      "title": "改善点タイトル",
      "description": "詳細説明",
      "drill": "練習ドリル",
      "youtube_search": "golf swing drill english keywords"
    }
  ],
  "coach_message": "励ましメッセージ"
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: '1分間のリクエスト上限（5回）に達しました。' });

  const form = new IncomingForm({ maxFileSize: MAX_FILE_SIZE });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'ファイルの読み込みに失敗しました' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'ファイルが見つかりません' });

    const mimeType = file.mimetype || '';
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) return res.status(400).json({ error: '対応していないファイル形式です' });

    try {
      const imageData = fs.readFileSync(file.filepath);
      const base64 = imageData.toString('base64');
      const imageMime = mimeType.startsWith('video/') ? 'image/jpeg' : mimeType;

      const apiKey = process.env.GEMINI_API_KEY;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: SYSTEM_PROMPT },
            { inline_data: { mime_type: imageMime, data: base64 } }
          ]}],
          generationConfig: { maxOutputTokens: 2500, temperature: 0.3 }
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '解析に失敗しました');

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      // JSONを安全にパース（AIが余分なテキストや改行を含む場合に対応）
      let result;
      try {
        // まずそのままパースを試みる
        const clean = text.replace(/```json|```/g, '').trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON not found');
        // 制御文字を除去してパース
        const sanitized = jsonMatch[0]
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
          .replace(/,\s*([\]}])/g, '$1'); // trailing commaを除去
        result = JSON.parse(sanitized);
      } catch(parseErr) {
        // フォールバック：最低限の結果を返す
        result = {
          score: 60,
          score_comment: '解析は完了しましたが、詳細データの取得に失敗しました',
          pose: null,
          annotations: [],
          good_points: ['画像を確認しました'],
          improvements: [{
            priority: 1,
            title: '再度お試しください',
            description: '解析結果の取得に失敗しました。もう一度試してください。',
            drill: '明るい場所で撮影した画像をお使いください',
            youtube_search: 'golf swing basics drill'
          }],
          coach_message: '画像が取得できました。再度解析をお試しください。'
        };
      }
      res.json({ result });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    } finally {
      try { fs.unlinkSync(file.filepath); } catch {}
    }
  });
}
