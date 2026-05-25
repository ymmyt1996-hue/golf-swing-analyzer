import cv2
import numpy as np
import json
import os
import sys
from openai import OpenAI
import base64
from typing import List, Dict, Any

# API設定
client = OpenAI() # Manus環境では自動設定される

class GolfAnalyzer:
    def __init__(self, video_path: str):
        self.video_path = video_path
        self.output_video_path = "analyzed_swing.mp4"
        self.pose_data = []
        self.analysis_result = {}

    def extract_frames(self, interval_ms: int = 500) -> List[np.ndarray]:
        """動画から解析用のフレームを抽出する"""
        cap = cv2.VideoCapture(self.video_path)
        frames = []
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_interval = int(fps * (interval_ms / 1000))
        
        count = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            if count % frame_interval == 0:
                frames.append(frame)
            count += 1
        cap.release()
        return frames

    def analyze_with_ai(self):
        """OpenAI (GPT-4o/4.1) を使用してフレームを解析し、軌道データを取得する"""
        frames = self.extract_frames(interval_ms=300)
        base64_frames = []
        for frame in frames:
            _, buffer = cv2.imencode(".jpg", frame)
            base64_frames.append(base64.b64encode(buffer).decode("utf-8"))
        
        prompt = """あなたはプロのゴルフコーチです。提供されたゴルフスイングの時系列画像（フレーム）を分析してください。
以下の2つの情報を出力してください：

1. 各フレームにおける主要な関節とクラブの位置（座標 0-1000）。
   特に「club_head」の軌跡が重要です。
   trajectory配列の各要素は、提供された画像の順番に対応させてください。

2. スイングの全体的な診断結果（スコア、要約、良い点、改善点、練習ドリル）。

以下のJSON形式のみで回答してください：
{
  "trajectory": [
    {"timestamp_ms": 0, "club_head": {"x": 500, "y": 800}, "hands": {"x": 500, "y": 600}, "head": {"x": 500, "y": 200}},
    ...
  ],
  "analysis": {
    "score": 85,
    "summary": "スイング全体の印象",
    "good_points": ["良い点1", "良い点2"],
    "improvements": [
      {"title": "改善点", "description": "詳細", "drill": "練習方法"}
    ]
  }
}
"""
        
        messages = [
            {"role": "system", "content": "You are a professional golf coach."},
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                *[{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}} for b64 in base64_frames]
            ]}
        ]
        
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=messages,
            response_format={"type": "json_object"}
        )
        
        self.analysis_result = json.loads(response.choices[0].message.content)
        # タイムスタンプを補完
        interval = 300
        for i, t in enumerate(self.analysis_result.get("trajectory", [])):
            t["timestamp_ms"] = i * interval
            
        return self.analysis_result

    def draw_overlay(self):
        """解析結果を元に動画に軌道と骨格をオーバーレイする"""
        cap = cv2.VideoCapture(self.video_path)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(self.output_video_path, fourcc, fps, (width, height))
        
        trajectory = self.analysis_result.get("trajectory", [])
        
        frame_idx = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            current_ms = (frame_idx / fps) * 1000
            
            # 軌道の描画（これまでの軌跡をすべて描画）
            points = []
            for t in trajectory:
                if t["timestamp_ms"] <= current_ms:
                    x = int(t["club_head"]["x"] * width / 1000)
                    y = int(t["club_head"]["y"] * height / 1000)
                    points.append((x, y))
            
            for i in range(1, len(points)):
                cv2.line(frame, points[i-1], points[i], (0, 255, 255), 3) # 黄色の軌跡
            
            # 現在のフレームに最も近いポーズ情報を描画
            closest_pose = min(trajectory, key=lambda x: abs(x["timestamp_ms"] - current_ms))
            if abs(closest_pose["timestamp_ms"] - current_ms) < 200:
                # 頭
                hx = int(closest_pose["head"]["x"] * width / 1000)
                hy = int(closest_pose["head"]["y"] * height / 1000)
                cv2.circle(frame, (hx, hy), 10, (0, 0, 255), -1)
                
                # 手とクラブヘッドのライン
                hand_x = int(closest_pose["hands"]["x"] * width / 1000)
                hand_y = int(closest_pose["hands"]["y"] * height / 1000)
                head_x = int(closest_pose["club_head"]["x"] * width / 1000)
                head_y = int(closest_pose["club_head"]["y"] * height / 1000)
                cv2.line(frame, (hand_x, hand_y), (head_x, head_y), (255, 0, 0), 5)
            
            out.write(frame)
            frame_idx += 1
            
        cap.release()
        out.release()
        return self.output_video_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python golf_analyzer.py <video_path>")
        sys.exit(1)
        
    video_path = sys.argv[1]
    analyzer = GolfAnalyzer(video_path)
    
    print("AIによるスイング分析を開始します...")
    # 実際にはここで API 呼び出しを行いますが、デモ用にモックデータを作成するロジックも検討
    # ここではコードの構造を示します
    try:
        result = analyzer.analyze_with_ai()
        print("分析完了。動画の生成を開始します...")
        output_path = analyzer.draw_overlay()
        print(f"完了しました。出力ファイル: {output_path}")
        
        # 結果をJSONで出力
        with open("analysis_report.json", "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print(f"エラーが発生しました: {e}")
