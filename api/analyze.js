import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 動画用にサイズを拡大

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = new IncomingForm({ maxFileSize: MAX_FILE_SIZE });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({ error: 'ファイルの読み込みに失敗しました' });
    }

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ error: 'ファイルが見つかりません' });
    }

    const inputPath = file.filepath;
    
    // 一意なファイル名を生成（タイムスタンプ + ランダム）
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const uniqueName = `swing_${timestamp}_${random}`;
    
    // /public/videos/ ディレクトリのパス
    const publicVideosDir = path.join(process.cwd(), 'public', 'videos');
    
    // ディレクトリが存在しなければ作成
    if (!fs.existsSync(publicVideosDir)) {
      fs.mkdirSync(publicVideosDir, { recursive: true });
    }
    
    const outputPath = path.join(publicVideosDir, `${uniqueName}.mp4`);
    const analysisReportPath = path.join(publicVideosDir, `${uniqueName}_report.json`);

    try {
      // Pythonスクリプトを呼び出して解析と動画生成を行う
      const command = `python3 /home/ubuntu/golf_analyzer.py "${inputPath}"`;
      
      const { stdout, stderr } = await execPromise(command);
      
      if (stderr) {
        console.error(`Python stderr: ${stderr}`);
      }
      
      console.log(`Python stdout: ${stdout}`);
      
      // 解析結果の読み込み
      const analysisData = JSON.parse(
        fs.readFileSync('analysis_report.json', 'utf8')
      );
      
      // 生成された analyzed_swing.mp4 を /public/videos/ に移動
      const tempVideoPath = 'analyzed_swing.mp4';
      if (fs.existsSync(tempVideoPath)) {
        fs.renameSync(tempVideoPath, outputPath);
      }
      
      // 解析レポートも保存
      fs.writeFileSync(
        analysisReportPath,
        JSON.stringify(analysisData, null, 2),
        'utf8'
      );
      
      // レスポンスを返す
      // 注意: Vercel の環境では、public ディレクトリのファイルは自動的に静的ファイルとして提供されます
      const videoUrl = `/videos/${uniqueName}.mp4`;
      
      res.json({
        result: {
          message: '分析が完了しました。',
          analysis: analysisData.analysis,
          trajectory: analysisData.trajectory,
          video_url: videoUrl,
          video_ready: true
        }
      });
      
    } catch (error) {
      console.error(`Error: ${error}`);
      return res.status(500).json({ 
        error: '解析中にエラーが発生しました',
        details: error.message 
      });
    }
  });
}
