/**
 * サーバー起動時に一度だけ走る（Next.js の instrumentation）。
 * スリープ・再起動・強制終了で「生成中」のまま止まった入稿データの生成を、
 * 起動後に自動で再開させる。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startPendingSweeper } = await import('./lib/pipeline');
  startPendingSweeper();
}
