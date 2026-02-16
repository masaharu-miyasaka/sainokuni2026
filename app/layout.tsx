export const metadata = {
  title: "彩の国 タイムテーブルメーカー",
  description: "彩の国トレイルランニングレース2026 タイムテーブル生成ツール",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
